"""The only place a Graph API URL is built or the access token is attached.

Every other module in this package asks this one to talk to Meta. That is not
tidiness for its own sake: the token is the single most dangerous value in the
deployment — it can message the whole company from the business number — and a
second place that handles it is a second place it can be logged, leaked into an
error body, or accidentally rendered into a response.

**Versioning is pinned, never floating.** `settings.whatsapp_graph_version`
goes into every URL. Meta ships breaking changes behind version numbers and
"whatever is current" is how an integration stops working on a date nobody
chose.

**Errors come back typed.** Meta answers failures with HTTP 400 and a JSON
body whose meaning is entirely in `error.code` — 131047 is "the 24-hour window
closed", 132001 is "that template does not exist in that language", 131049 is
"this account is capped because the template is Marketing". Those are three
completely different operational problems that a bare `raise_for_status()`
flattens into "400 Bad Request". `MetaError` carries the code through so
`services/whatsapp/errors.py` can turn it into a sentence and the delivery log
can be filtered by it.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger("app.whatsapp")

GRAPH_HOST = "https://graph.facebook.com"


class MetaError(Exception):
    """A refusal from the Graph API, with the code that says what it means.

    `code` is Meta's numeric error code and is the field worth branching on.
    `status` is the HTTP status, which is almost always 400 and therefore
    almost never informative on its own.
    """

    def __init__(
        self,
        *,
        code: int | None,
        subcode: int | None = None,
        title: str | None = None,
        detail: str | None = None,
        trace_id: str | None = None,
        status: int | None = None,
    ) -> None:
        self.code = code
        self.subcode = subcode
        self.title = title
        self.detail = detail
        self.trace_id = trace_id
        self.status = status
        super().__init__(f"[{code}] {title or ''} {detail or ''}".strip())


class MetaUnreachable(Exception):
    """The request never got an answer — DNS, TLS, timeout, connection reset.

    Deliberately not a `MetaError`: there is no code, nothing was refused, and
    the correct response is usually to try again later rather than to change
    anything. Collapsing the two would mean the delivery log could not tell
    "Meta said no" apart from "we could not reach Meta", which are the two
    halves of every escalation.
    """


def whatsapp_enabled() -> bool:
    """Whether this deployment is wired up to Meta at all.

    Empty credentials are the normal state of a fresh checkout and of the test
    database, so every entry point asks rather than assuming — the same shape
    as `push.push_enabled()` and the OpenRouter key in `core/config.py`. With
    this False the sender skips (with a reason on the record), the admin routes
    answer 503 with a sentence, and nothing else in the app changes.
    """
    settings = get_settings()
    return bool(
        settings.whatsapp_access_token
        and settings.whatsapp_phone_number_id
        and settings.whatsapp_business_account_id
    )


def templates_enabled() -> bool:
    """Template management needs the WABA id and the token, but not a phone
    number — the admin page is usable while the number is still being
    verified, which is the order these actually get set up in."""
    settings = get_settings()
    return bool(settings.whatsapp_access_token and settings.whatsapp_business_account_id)


class GraphClient:
    """A thin async wrapper. One instance per call site; httpx pools sockets.

    No retries here. A send is already running in a background task after the
    response has gone out, and the useful retry policy differs by caller: a
    template sync can simply be run again from the admin page, while a
    duplicate message send is worse than a missed one. Retry belongs to
    whoever knows which of those they are.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._token = settings.whatsapp_access_token
        self._base = f"{GRAPH_HOST}/{settings.whatsapp_graph_version}"
        self._timeout = settings.whatsapp_request_timeout_seconds

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict:
        url = f"{self._base}/{path.lstrip('/')}"
        headers = {"Authorization": f"Bearer {self._token}"}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as http:
                response = await http.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            # The URL is safe to log; the token is in a header and stays there.
            logger.warning("WhatsApp %s %s unreachable: %s", method, path, exc)
            raise MetaUnreachable(str(exc)) from exc

        if response.status_code >= 400:
            raise _parse_error(response)
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise MetaUnreachable(f"non-JSON reply from Graph: {response.text[:200]}") from exc

    async def get(self, path: str, params: dict | None = None) -> dict:
        return await self._request("GET", path, params=params or {})

    async def post(self, path: str, json: dict) -> dict:
        return await self._request("POST", path, json=json)

    async def delete(self, path: str, params: dict | None = None) -> dict:
        return await self._request("DELETE", path, params=params or {})


def _parse_error(response: httpx.Response) -> MetaError:
    """Pull Meta's error envelope apart, and survive it not being one.

    A 500 from a proxy in front of Graph, or an HTML error page from a network
    appliance, arrives here too. Those have no `error` object, and raising a
    `KeyError` while handling an error is how a useful failure becomes an
    unhandled exception in a background task.
    """
    code = subcode = None
    title = detail = trace_id = None
    try:
        body = response.json()
        error = body.get("error") or {}
        code = error.get("code")
        subcode = error.get("error_subcode")
        title = error.get("error_user_title") or error.get("type")
        detail = (
            error.get("error_user_msg")
            or error.get("message")
            or error.get("error_data", {}).get("details")
        )
        trace_id = error.get("fbtrace_id")
    except ValueError:
        detail = response.text[:500]
    return MetaError(
        code=code,
        subcode=subcode,
        title=title,
        detail=detail,
        trace_id=trace_id,
        status=response.status_code,
    )
