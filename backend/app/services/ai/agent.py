"""The tool-calling loop.

Call the model with the caller's permitted tools; if it asks for tools, run
them and hand back the results; repeat until it answers or the iteration cap
is hit. The cap is not a safety net, it is a budget — every round is a paid
request upstream.

When the cap *is* hit, the loop makes one final call with no tools offered,
which forces an answer out of whatever was already gathered. The alternative
(erroring out after six paid round-trips) charges the user for the work and
then throws it away.

Nothing in here knows how the answer reaches a browser: it emits events
through a callback, and the router decides those are SSE frames. That keeps
the loop testable without a transport.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.user import User
from app.services.ai.openrouter import AiRequestError, ChatClient, Completion
from app.services.ai.prompt import build_system_prompt
from app.services.ai.tools import run_tool, schemas_for

logger = logging.getLogger(__name__)

Emit = Callable[[str, dict], Awaitable[None]]


@dataclass
class ToolInvocation:
    name: str
    arguments: dict
    ok: bool

    def as_dict(self) -> dict:
        return {"name": self.name, "arguments": self.arguments, "ok": self.ok}


@dataclass
class AgentResult:
    answer: str
    tool_calls: list[ToolInvocation] = field(default_factory=list)
    charts: list[dict] = field(default_factory=list)
    model: str = ""
    iterations: int = 0
    usage: dict[str, Any] = field(default_factory=dict)
    hit_iteration_cap: bool = False


def _final_answer(message: dict, said_along_the_way: list[str]) -> str:
    """The closing message, or what the model already said if it has nothing
    left to add.

    A model that writes its whole answer next to its last tool call and then
    closes with an empty message is not an error — it already answered. The
    closing message wins when there is one, because it was written with every
    tool result in hand; the earlier prose is the fallback, not a prefix, so
    a model that narrates *and* summarises doesn't say everything twice.
    """
    closing = (message.get("content") or "").strip()
    if closing:
        return closing
    return "\n\n".join(said_along_the_way).strip()


def _take_chart(result: Any) -> dict | None:
    """Lift a chart spec out of a tool result before it reaches the model.

    `render_chart` returns the full spec so this loop can stream it to the
    browser and store it on the message; the model gets the short `rendered`
    ack that stays behind. Feeding it the series back would pay for those
    numbers a second time on every later turn of the conversation, to tell it
    something it just said.
    """
    if not isinstance(result, dict):
        return None
    spec = result.pop("chart_spec", None)
    return spec if isinstance(spec, dict) else None


async def _noop(event: str, data: dict) -> None:  # pragma: no cover - trivial
    return None


def _parse_arguments(raw: Any) -> tuple[dict, str | None]:
    """Models hand back tool arguments as a JSON *string*, and sometimes a
    malformed one. A parse failure is the model's mistake to correct, so it
    comes back as a tool result rather than an exception."""
    if isinstance(raw, dict):
        return raw, None
    if not raw:
        return {}, None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return {}, "Arguments were not valid JSON. Send them as a JSON object."
    if not isinstance(parsed, dict):
        return {}, "Arguments must be a JSON object."
    return parsed, None


def _merge_usage(total: dict, usage: dict) -> dict:
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        if isinstance(usage.get(key), int):
            total[key] = total.get(key, 0) + usage[key]
    return total


async def run_agent(
    db: AsyncSession,
    user: User,
    *,
    client: ChatClient,
    question: str,
    history: list[dict] | None = None,
    emit: Emit | None = None,
    max_iterations: int | None = None,
) -> AgentResult:
    """`history` is prior user/assistant turns only — tool traffic from older
    turns is deliberately not replayed. It would multiply the context on
    every message for data the model can simply look up again, and stale
    numbers presented as current are worse than a second query."""
    emit = emit or _noop
    settings = get_settings()
    max_iterations = max_iterations or settings.ai_max_tool_iterations

    tools = schemas_for(user)
    messages: list[dict] = [{"role": "system", "content": build_system_prompt(user)}]
    messages += history or []
    messages.append({"role": "user", "content": question})

    invocations: list[ToolInvocation] = []
    charts: list[dict] = []
    # Prose the model wrote *while* asking for a tool. Some models emit only
    # a tool call and save the words for the end; others write the answer and
    # attach the call to the same message. This loop used to keep the content
    # of the final message only, which silently threw the second kind away —
    # answers arrived truncated, or empty when the model had said everything
    # it meant to say alongside its last call.
    said_along_the_way: list[str] = []
    usage: dict[str, Any] = {}
    completion: Completion | None = None
    iterations = 0

    for iterations in range(1, max_iterations + 1):
        completion = await client.complete(messages=messages, tools=tools)
        usage = _merge_usage(usage, completion.usage)
        message = completion.message
        messages.append(message)

        calls = message.get("tool_calls") or []
        if not calls:
            return AgentResult(
                answer=_final_answer(message, said_along_the_way),
                tool_calls=invocations,
                charts=charts,
                model=completion.model,
                iterations=iterations,
                usage=usage,
            )

        spoken = (message.get("content") or "").strip()
        if spoken:
            said_along_the_way.append(spoken)

        for call in calls:
            function = call.get("function") or {}
            name = function.get("name") or "unknown"
            args, parse_error = _parse_arguments(function.get("arguments"))

            await emit("tool", {"name": name, "status": "running", "arguments": args})

            if parse_error is not None:
                result: Any = {"error": parse_error}
            else:
                result = await run_tool(db, user, name=name, arguments=args)

            ok = not (isinstance(result, dict) and "error" in result)
            invocations.append(ToolInvocation(name=name, arguments=args, ok=ok))
            await emit("tool", {"name": name, "status": "done" if ok else "refused"})

            # Charts go out to the browser the moment they exist rather than
            # waiting for the written answer — the same reasoning as the
            # tool chips. The model may still be composing a paragraph about
            # a graph the user is already looking at.
            chart = _take_chart(result)
            if chart is not None:
                charts.append(chart)
                await emit("chart", chart)

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id"),
                    "name": name,
                    "content": json.dumps(result, default=str),
                }
            )

    # Cap reached and it still wants tools. Take the tools away and make it
    # answer from what it has.
    logger.info("agent hit the %s-iteration cap for user %s", max_iterations, user.id)
    await emit("status", {"message": "Wrapping up with what I found"})
    final = await client.complete(messages=messages, tools=None)
    usage = _merge_usage(usage, final.usage)
    answer = _final_answer(final.message, said_along_the_way)
    return AgentResult(
        answer=answer
        or "I ran out of lookups before I could finish that. Try asking about one "
        "client or one person at a time.",
        tool_calls=invocations,
        charts=charts,
        model=final.model or (completion.model if completion else ""),
        iterations=iterations,
        usage=usage,
        hit_iteration_cap=True,
    )


__all__ = ["AgentResult", "AiRequestError", "ToolInvocation", "run_agent"]
