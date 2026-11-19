"""Request and response shapes for the WhatsApp admin page.

Nothing here carries a credential. `ConnectionRead` deliberately reports
whether a token is *present* and what it can reach, never the token itself —
an admin screen that prints a System User token puts it into a browser cache,
a screenshot and a support thread, and that token can message the whole
company from the business number.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ConnectionRead(BaseModel):
    """Is this deployment actually wired up, and to what."""

    configured: bool
    #: Present and non-empty. Never the value.
    has_token: bool
    has_app_secret: bool
    has_verify_token: bool
    graph_version: str
    waba_id: str | None = None
    phone_number_id: str | None = None
    #: Straight from Meta when reachable, so a wrong id shows as an error here
    #: rather than as silence at the first hand-off.
    display_phone_number: str | None = None
    verified_name: str | None = None
    quality_rating: str | None = None
    messaging_limit: str | None = None
    platform_type: str | None = None
    #: Null until the first webhook ever arrives. A connection that looks
    #: healthy but has never received one is a subscription that was never set
    #: up, which is invisible from every other angle.
    webhook_last_received_at: datetime | None = None
    #: Populated when the live check failed, in English.
    error: str | None = None


class TemplateRead(BaseModel):
    name: str
    language: str
    status: str
    category: str
    requested_category: str
    quality_score: str | None = None
    rejected_reason: str | None = None
    meta_template_id: str | None = None
    submitted_at: datetime | None = None
    approved_at: datetime | None = None
    last_status_at: datetime | None = None
    last_synced_at: datetime | None = None
    #: Meta has re-filed this away from the category we asked for.
    category_drifted: bool
    #: The code has changed since this version was approved — resubmit.
    drifted: bool
    #: Defined in the registry but never sent to Meta.
    missing: bool
    #: At Meta but not in the registry: created by hand, never sent from here.
    unmanaged: bool
    #: Registry metadata, for the page rather than for Meta.
    purpose: str | None = None
    recipient: str | None = None
    param_count: int | None = None
    body_preview: str | None = None
    buttons: list[str] = Field(default_factory=list)


class TemplateSyncResult(BaseModel):
    seen: int
    changed: int
    unmanaged: list[str]
    synced_at: datetime


class EventRuleRead(BaseModel):
    """One row of the Events tab."""

    event_key: str
    template_name: str
    enabled: bool
    tier: Literal["core", "exception", "scheduled"]
    recipient: str
    purpose: str
    #: False when the template behind it is not approved — the toggle is on but
    #: nothing would send, and saying so here stops that being a mystery.
    template_ready: bool
    template_status: str | None = None


class SettingsRead(BaseModel):
    enabled: bool
    pilot_user_ids: list[uuid.UUID]
    event_flags: dict[str, bool]
    updated_at: datetime | None = None


class SettingsUpdate(BaseModel):
    enabled: bool | None = None
    pilot_user_ids: list[uuid.UUID] | None = None
    event_flags: dict[str, bool] | None = None


class MessageRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    job_id: uuid.UUID | None = None
    job_code: str | None = None
    event_key: str | None = None
    template_name: str | None = None
    to_phone: str | None = None
    status: str
    reason: str | None = None
    error_code: int | None = None
    error_detail: str | None = None
    button_action: str | None = None
    button_tapped_at: datetime | None = None
    sent_at: datetime | None = None
    delivered_at: datetime | None = None
    read_at: datetime | None = None
    failed_at: datetime | None = None
    created_at: datetime


class MessageStats(BaseModel):
    """Counted over the whole filtered set, not over the page — the cards above
    the table must not shrink when you turn to page two (docs/07)."""

    sent: int
    delivered: int
    read: int
    failed: int
    skipped: int


class NumberRead(BaseModel):
    """One row of the Numbers tab: can we actually reach this person."""

    user_id: uuid.UUID
    name: str
    email: str
    role: str
    is_active: bool
    phone: str | None = None
    phone_e164: str | None = None
    phone_display: str | None = None
    valid: bool
    opt_in: bool
    last_inbound_at: datetime | None = None
    #: Inside Meta's 24-hour service window right now, so a reply would be free.
    window_open: bool
    #: Another account holds the same number. A tap from it cannot be
    #: attributed to one person, so neither account can use a button.
    duplicate: bool
    reachable: bool


class NumberUpdate(BaseModel):
    """The two things the Numbers tab may change.

    The number itself is edited on the Users admin screen, which is where the
    roster is maintained; duplicating that here would be two forms writing one
    column. This sets consent and, separately, re-derives `phone_e164` from
    whatever `phone` currently holds.
    """

    opt_in: bool | None = None
    renormalise: bool = False


class TestSendRequest(BaseModel):
    template_name: str
    #: Defaults to the caller. Sending a test to somebody else is allowed but
    #: is an odd thing to do by accident, so it has to be named.
    user_id: uuid.UUID | None = None


class TestSendResult(BaseModel):
    status: str
    reason: str | None = None
    error_code: int | None = None
    error_detail: str | None = None
    wamid: str | None = None
    to_phone: str | None = None


class SchedulerRunResult(BaseModel):
    reconciled: TemplateSyncResult | None = None
    deadline_soon: int
    deadline_missed: int
