"""OpenRouter transport. Knows about HTTP; knows nothing about jobs or pods.

The gateway is the point: which model answers is `OPENROUTER_MODEL`, not a
code change (docs/08-roadmap.md). Everything here speaks the OpenAI-style
chat-completions shape OpenRouter exposes, so the same client works whichever
model that setting names.

Tool calls are resolved with `stream=false`. Streaming a response that may or
may not turn out to be a tool call means reassembling `tool_calls` from
deltas by index — real code with no way to verify it until an account exists.
The SSE contract the router exposes is event-based rather than token-based
precisely so token streaming can be added later without any caller changing:
a new `delta` event, same stream.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class AiUnavailable(RuntimeError):
    """No API key configured — the normal state before an account exists."""


class AiRequestError(RuntimeError):
    """The gateway refused, timed out, or answered with something unusable.

    `code` is for the failures a person can *act* on. Most gateway errors are
    "try again"; two are not — an empty balance and a dead key both mean the
    bot stays broken until someone visits OpenRouter. The UI branches on this
    to show what to do rather than a red line of text, so the code is part of
    the contract, not a logging detail.
    """

    code: str | None = None

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        self.code = code


@dataclass
class Completion:
    message: dict[str, Any]
    model: str
    usage: dict[str, Any] = field(default_factory=dict)


class ChatClient(Protocol):
    """What the agent loop needs. Implemented for real below, and stubbed in
    the tests so the loop is covered without a key or a network."""

    async def complete(
        self, *, messages: list[dict], tools: list[dict] | None = None
    ) -> Completion: ...


@dataclass
class OpenRouterClient:
    api_key: str
    base_url: str
    model: str
    timeout_seconds: int
    app_url: str = ""
    app_title: str = ""

    async def complete(
        self, *, messages: list[dict], tools: list[dict] | None = None
    ) -> Completion:
        if not self.api_key:
            raise AiUnavailable("OPENROUTER_API_KEY is not set")

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            # OpenRouter attributes usage to these on its dashboard.
            "HTTP-Referer": self.app_url,
            "X-Title": self.app_title,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as http:
                response = await http.post(
                    f"{self.base_url.rstrip('/')}/chat/completions",
                    json=payload,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            raise AiRequestError(
                f"The model did not respond within {self.timeout_seconds}s."
            ) from exc
        except httpx.HTTPError as exc:
            raise AiRequestError(f"Could not reach OpenRouter: {exc}") from exc

        if response.status_code == 401:
            raise AiRequestError(
                "OpenRouter rejected the API key.", code="invalid_key"
            )
        if response.status_code == 402:
            raise AiRequestError(
                "The OpenRouter account is out of credits.", code="out_of_credits"
            )
        if response.status_code == 429:
            raise AiRequestError("OpenRouter is rate-limiting this account. Try again shortly.")
        if response.status_code >= 400:
            # Body, not just the status: a 400 from a gateway is usually a
            # message about the payload, and hiding it makes this
            # undebuggable from a log.
            logger.error("openrouter %s: %s", response.status_code, response.text[:500])
            raise AiRequestError(
                f"OpenRouter returned {response.status_code}: {response.text[:200]}"
            )

        try:
            body = response.json()
            choice = body["choices"][0]
        except (ValueError, KeyError, IndexError) as exc:
            raise AiRequestError("OpenRouter returned a response in an unexpected shape.") from exc

        # Some models omit `content` entirely on a tool call; normalise it so
        # the message can be appended to the transcript unconditionally.
        message = dict(choice.get("message") or {})
        message.setdefault("role", "assistant")
        message.setdefault("content", None)

        return Completion(
            message=message,
            model=body.get("model", self.model),
            usage=body.get("usage") or {},
        )


def build_client() -> OpenRouterClient:
    settings = get_settings()
    return OpenRouterClient(
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
        model=settings.openrouter_model,
        timeout_seconds=settings.ai_request_timeout_seconds,
        app_url=settings.openrouter_app_url,
        app_title=settings.openrouter_app_title,
    )
