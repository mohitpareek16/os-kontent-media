import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import Page


class NotificationRead(BaseModel):
    id: uuid.UUID
    channel: str
    read_at: datetime | None
    created_at: datetime
    job_id: uuid.UUID | None = None
    pod_id: uuid.UUID | None = None
    event_type: str
    # Enough to actually read the inbox. Without these every row said
    # "Job stage changed" and nothing else — you had to open each one to
    # find out which video it was about.
    job_code: str
    job_title: str
    pod_name: str
    stage: str | None = None
    actor_name: str | None = None
    note: str | None = None
    # The sentence, rendered server-side (`services/notification_text.py`).
    # The inbox, the in-app toast and the push notification are three readers
    # of one event, and the third — a service worker with no page behind it —
    # cannot share a browser module with the other two. So the wording lives
    # in one place and rides on the row.
    headline: str = ""
    body: str = ""


class NotificationListResponse(Page[NotificationRead]):
    """One page of the inbox, plus how many are unread across the *whole*
    inbox — not just this page. The bell counts that number, and it used to
    be derived from a 50-row fetch, so 51 unread notifications displayed as
    50 and every read/unread filter had to happen in the browser."""

    unread: int


class PushSubscriptionCreate(BaseModel):
    """What `PushManager.subscribe()` hands back, flattened.

    The browser's own shape is `{endpoint, keys: {p256dh, auth}}`; it is
    flattened here because a nested model for two strings buys nothing, and
    the frontend has to pick them apart anyway to send them.
    """

    endpoint: str = Field(min_length=1, max_length=2000)
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)
    # So somebody can tell "my laptop" from "my phone" when turning one off.
    # Never parsed.
    user_agent: str | None = Field(default=None, max_length=400)


class PushKeyRead(BaseModel):
    """The application server's public key, which a browser needs before it
    can subscribe at all. Public by definition — it is handed to every client
    and is the thing a push service checks the signature against."""

    public_key: str
    enabled: bool


class PushTestResult(BaseModel):
    """How many browsers the test alert actually went to.

    The count is the whole point of the response. "Sent to 0 browsers" tells
    somebody who heard nothing that the problem is their subscription, not
    their speakers — which is the question the test button exists to answer.
    """

    sent_to: int
    delay_seconds: int
