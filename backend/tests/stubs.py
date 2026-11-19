"""A scripted stand-in for the model.

The agent loop is the part of Phase 3 most likely to break quietly, and it
cannot be exercised against a real model in CI — there is no key, and a real
model wouldn't be deterministic anyway. So the tests drive it with a fixed
script and assert on what it *did*: which tools it called, with what, and
what came back.

This is also how the prompt-injection regression is possible at all: the stub
plays the part of a model that has been fully talked into misbehaving, and
the assertion is that it still gets nothing.
"""
from __future__ import annotations

import json
from typing import Any

from app.services.ai.openrouter import Completion


def tool_call(
    name: str, arguments: dict | str, *, call_id: str = "call_1", content: str | None = None
) -> Completion:
    """A response where the model asks to run one tool.

    `content` is the prose some models write *alongside* the call rather than
    saving it for a closing message — pass it to play that kind of model.
    """
    return Completion(
        message={
            "role": "assistant",
            "content": content,
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": arguments
                        if isinstance(arguments, str)
                        else json.dumps(arguments),
                    },
                }
            ],
        },
        model="stub/model",
        usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    )


def says(text: str) -> Completion:
    """A response where the model just answers."""
    return Completion(
        message={"role": "assistant", "content": text},
        model="stub/model",
        usage={"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10},
    )


class StubClient:
    """Replays `script` one response per `complete()` call, recording what it
    was asked. `always` keeps answering after the script runs out, which is
    how the iteration-cap test keeps the model demanding tools forever."""

    def __init__(self, script: list[Completion], *, always: Completion | None = None):
        self.script = list(script)
        self.always = always
        self.calls: list[dict[str, Any]] = []

    async def complete(self, *, messages: list[dict], tools: list[dict] | None = None) -> Completion:
        self.calls.append({"messages": list(messages), "tools": tools})
        if self.script:
            return self.script.pop(0)
        if self.always is not None:
            return self.always
        raise AssertionError("StubClient ran out of scripted responses")

    @property
    def tool_results(self) -> list[dict]:
        """Every tool result that was fed back to the model, decoded."""
        out = []
        for call in self.calls:
            for message in call["messages"]:
                if message.get("role") == "tool":
                    out.append({"name": message.get("name"), "content": json.loads(message["content"])})
        # The transcript grows each round, so the same result appears in
        # every later call — de-duplicate by position.
        seen, unique = set(), []
        for item in out:
            key = json.dumps(item, sort_keys=True, default=str)
            if key not in seen:
                seen.add(key)
                unique.append(item)
        return unique
