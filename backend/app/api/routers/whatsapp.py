"""The admin API behind /admin/whatsapp. Owner only.

**Why owner-only when the other admin pages are Owner + Founder's Office.**
This one holds the keys to a channel that messages the whole company from the
business number and spends money doing it. `ADMIN_ROLES` is already "the Owner,
and only the Owner" (models/user.py) and the reasoning there — accounts, roles,
impersonation — applies at least as strongly here. Widening it is one constant.

Routers stay thin (docs/07): every one of these parses a request, calls into
`services/whatsapp/`, and returns. The Graph calls, the guard rails and the
drift arithmetic all live in the service layer, where the scheduler and the
tests reach them without going through HTTP.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.job import Job
from app.models.user import ADMIN_ROLES, User
from app.models.whatsapp import WhatsAppMessage, WhatsAppTemplate, WhatsAppWebhookEvent
from app.schemas.common import Page
from app.schemas.whatsapp import (
    ConnectionRead,
    EventRuleRead,
    MessageRead,
    MessageStats,
    NumberRead,
    NumberUpdate,
    SchedulerRunResult,
    SettingsRead,
    SettingsUpdate,
    TemplateRead,
    TemplateSyncResult,
    TestSendRequest,
    TestSendResult,
)
from app.services.whatsapp import (
    errors,
    events,
    phone,
    registry,
    scheduler,
    send,
    settings_store,
    templates,
)
from app.services.whatsapp.client import (
    GraphClient,
    MetaError,
    MetaUnreachable,
    templates_enabled,
    whatsapp_enabled,
)

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

# Meta's 24-hour customer-service window: inside it a reply is free-form and
# free, outside it only an approved template sends at all.
SERVICE_WINDOW = timedelta(hours=24)


def _require_configured() -> None:
    """503 with a sentence, rather than a failure deeper inside an HTTP call.

    The same shape as `/api/chat` without an OpenRouter key: an unconfigured
    integration is a normal state of a fresh checkout, and the screen should
    say which credential is missing rather than show a spinner.
    """
    if not templates_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN and "
                "WHATSAPP_BUSINESS_ACCOUNT_ID in the environment — see docs/13-whatsapp.md."
            ),
        )


def _meta_http_error(exc: Exception) -> HTTPException:
    """Meta's refusal, in this API's error shape.

    Passed through rather than flattened: Meta's own messages on a template
    submission are usually specific enough to act on ("body text cannot end
    with a variable"), and replacing them with a generic sentence would throw
    away the only actionable thing in the response.
    """
    code, label, sentence = errors.explain(exc)
    return HTTPException(status_code=400, detail=f"{label}: {sentence}")


# --------------------------------------------------------------------------
# Connection
# --------------------------------------------------------------------------


@router.get("/status", response_model=ConnectionRead)
async def connection_status(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Health, read live from Meta where possible.

    Deliberately does not fail when Meta is unreachable: an admin page that
    500s because someone else's API is down tells you nothing about which of
    the two is broken. The `error` field carries the reason and every locally
    known field is still filled in.
    """
    settings = get_settings()
    last_webhook = (
        await db.execute(select(func.max(WhatsAppWebhookEvent.received_at)))
    ).scalar_one_or_none()

    read = ConnectionRead(
        configured=whatsapp_enabled(),
        has_token=bool(settings.whatsapp_access_token),
        has_app_secret=bool(settings.whatsapp_app_secret),
        has_verify_token=bool(settings.whatsapp_verify_token),
        graph_version=settings.whatsapp_graph_version,
        waba_id=settings.whatsapp_business_account_id or None,
        phone_number_id=settings.whatsapp_phone_number_id or None,
        webhook_last_received_at=last_webhook,
    )
    if not settings.whatsapp_phone_number_id or not settings.whatsapp_access_token:
        read.error = "No access token or phone number id configured."
        return read

    try:
        client = GraphClient()
        result = await client.get(
            settings.whatsapp_phone_number_id,
            {
                "fields": (
                    "display_phone_number,verified_name,quality_rating,"
                    "messaging_limit_tier,platform_type"
                )
            },
        )
        read.display_phone_number = result.get("display_phone_number")
        read.verified_name = result.get("verified_name")
        read.quality_rating = result.get("quality_rating")
        read.messaging_limit = result.get("messaging_limit_tier")
        read.platform_type = result.get("platform_type")
    except (MetaError, MetaUnreachable) as exc:
        _, label, sentence = errors.explain(exc)
        read.error = f"{label}: {sentence}"
    return read


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------


@router.get("/templates", response_model=list[TemplateRead])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """The registry and the mirror, joined — which is the whole point of the tab.

    Three states a row can be in, and they have three different fixes:
    *missing* (defined here, never submitted), *drifted* (submitted, then the
    code changed — resubmit), and *unmanaged* (at Meta, not in the registry —
    somebody made it by hand and nothing can send it).
    """
    rows = (await db.execute(select(WhatsAppTemplate))).scalars().all()
    by_key = {(row.name, row.language): row for row in rows}

    out: list[TemplateRead] = []
    for spec in registry.all_specs():
        row = by_key.pop((spec.name, spec.language), None)
        out.append(_template_read(spec=spec, row=row))
    # Whatever is left in the mirror has no definition behind it.
    for row in by_key.values():
        out.append(_template_read(spec=None, row=row))
    return sorted(out, key=lambda t: (t.unmanaged, t.name))


def _template_read(*, spec: registry.TemplateSpec | None, row: WhatsAppTemplate | None):
    if spec is None and row is not None:
        return TemplateRead(
            name=row.name,
            language=row.language,
            status=row.status,
            category=row.category,
            requested_category=row.requested_category,
            quality_score=row.quality_score,
            rejected_reason=row.rejected_reason,
            meta_template_id=row.meta_template_id,
            submitted_at=row.submitted_at,
            approved_at=row.approved_at,
            last_status_at=row.last_status_at,
            last_synced_at=row.last_synced_at,
            category_drifted=row.category_drifted,
            drifted=False,
            missing=False,
            unmanaged=True,
        )
    assert spec is not None
    return TemplateRead(
        name=spec.name,
        language=spec.language,
        status=row.status if row else "NOT_SUBMITTED",
        category=row.category if row else spec.category,
        requested_category=row.requested_category if row else spec.category,
        quality_score=row.quality_score if row else None,
        rejected_reason=row.rejected_reason if row else None,
        meta_template_id=row.meta_template_id if row else None,
        submitted_at=row.submitted_at if row else None,
        approved_at=row.approved_at if row else None,
        last_status_at=row.last_status_at if row else None,
        last_synced_at=row.last_synced_at if row else None,
        category_drifted=row.category_drifted if row else False,
        drifted=templates.drift_for(row, spec),
        missing=row is None,
        unmanaged=False,
        purpose=spec.purpose,
        recipient=registry.RECIPIENT_LABELS.get(spec.recipient, spec.recipient),
        param_count=spec.param_count(),
        body_preview=spec.body,
        buttons=[b.text for b in spec.buttons],
    )


@router.post("/templates/sync", response_model=TemplateSyncResult)
async def sync_templates(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Pull every template on the account back into the mirror."""
    _require_configured()
    try:
        result = await templates.sync(db)
    except (MetaError, MetaUnreachable) as exc:
        raise _meta_http_error(exc) from exc
    await db.commit()
    return result


@router.post("/templates/{name}/submit", response_model=TemplateRead)
async def submit_template(
    name: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    _require_configured()
    spec = registry.get(name)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"No template named '{name}' in the registry")
    try:
        row = await templates.submit(db, name=name)
    except (MetaError, MetaUnreachable) as exc:
        raise _meta_http_error(exc) from exc
    await db.commit()
    await db.refresh(row)
    return _template_read(spec=spec, row=row)


@router.post("/templates/{name}/resubmit", response_model=TemplateRead)
async def resubmit_template(
    name: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Make Meta's copy match the code again — after a rejection, or after the
    body changed here and the Templates tab started showing drift."""
    _require_configured()
    spec = registry.get(name)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"No template named '{name}' in the registry")
    try:
        row = await templates.resubmit(db, name=name)
    except (MetaError, MetaUnreachable) as exc:
        raise _meta_http_error(exc) from exc
    await db.commit()
    await db.refresh(row)
    return _template_read(spec=spec, row=row)


@router.delete("/templates/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    name: str,
    language: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    _require_configured()
    settings = get_settings()
    try:
        await templates.delete(
            db, name=name, language=language or settings.whatsapp_default_language
        )
    except (MetaError, MetaUnreachable) as exc:
        raise _meta_http_error(exc) from exc
    await db.commit()


# --------------------------------------------------------------------------
# Events
# --------------------------------------------------------------------------


@router.get("/events", response_model=list[EventRuleRead])
async def list_event_rules(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Every event that can send, whether it is on, and whether it *would*.

    `template_ready` is the second half and the one that saves an afternoon: a
    toggle can be on while the template behind it sits in review, and without
    saying so the page shows a green switch for something that sends nothing.
    """
    row = await settings_store.load(db)
    mirror = {
        (t.name, t.language): t
        for t in (await db.execute(select(WhatsAppTemplate))).scalars().all()
    }

    rules: list[EventRuleRead] = []
    all_keys = {
        **events.EVENT_TEMPLATES,
        scheduler.EVENT_DEADLINE_SOON: "deadline_approaching_v2",
        scheduler.EVENT_DEADLINE_MISSED: "deadline_missed_v2",
    }
    # The tiers in docs/13: the core loop fires on a stage change, exceptions
    # are rare and cannot wait for a digest, and the scheduler's fire on a date
    # rather than on a move. Grouping is for the page only — nothing branches
    # on it.
    exception_keys = {
        "job_reassigned",
    }
    for key, template_name in sorted(all_keys.items()):
        spec = registry.get(template_name)
        template_row = mirror.get((template_name, spec.language if spec else "en"))
        if key.startswith("scheduled:"):
            tier = "scheduled"
        elif key in exception_keys:
            tier = "exception"
        else:
            tier = "core"
        rules.append(
            EventRuleRead(
                event_key=key,
                template_name=template_name,
                enabled=settings_store.event_enabled(row, key),
                tier=tier,
                recipient=registry.RECIPIENT_LABELS.get(
                    spec.recipient if spec else "any", "Any recipient"
                ),
                purpose=spec.purpose if spec else "",
                template_ready=bool(
                    template_row and template_row.is_sendable
                    and template_row.category == "UTILITY"
                    and template_row.requested_category == "UTILITY"
                ),
                template_status=template_row.status if template_row else "NOT_SUBMITTED",
            )
        )
    return rules


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------


@router.get("/settings", response_model=SettingsRead)
async def read_settings(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    row = await settings_store.load(db)
    await db.commit()
    return SettingsRead(
        enabled=row.enabled,
        pilot_user_ids=[uuid.UUID(str(u)) for u in (row.pilot_user_ids or [])],
        event_flags=row.event_flags or {},
        updated_at=row.updated_at,
    )


@router.patch("/settings", response_model=SettingsRead)
async def update_settings(
    payload: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    row = await settings_store.load(db)
    if payload.enabled is not None:
        row.enabled = payload.enabled
    if payload.pilot_user_ids is not None:
        row.pilot_user_ids = [str(u) for u in payload.pilot_user_ids]
    if payload.event_flags is not None:
        # Merged, not replaced: the page sends the toggle that moved, and a
        # replace would silently re-enable everything the operator had turned
        # off in a tab they did not have open.
        row.event_flags = {**(row.event_flags or {}), **payload.event_flags}
    await db.commit()
    await db.refresh(row)
    return SettingsRead(
        enabled=row.enabled,
        pilot_user_ids=[uuid.UUID(str(u)) for u in (row.pilot_user_ids or [])],
        event_flags=row.event_flags or {},
        updated_at=row.updated_at,
    )


# --------------------------------------------------------------------------
# Delivery log
# --------------------------------------------------------------------------


@router.get("/messages", response_model=Page[MessageRead])
async def list_messages(
    status_filter: str | None = Query(None, alias="status"),
    user_id: uuid.UUID | None = None,
    job_id: uuid.UUID | None = None,
    event_key: str | None = None,
    template_name: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Filtered and paged in SQL, per docs/07 — this table grows with every
    notification the app sends."""
    filters = []
    if status_filter:
        filters.append(WhatsAppMessage.status == status_filter)
    if user_id:
        filters.append(WhatsAppMessage.user_id == user_id)
    if job_id:
        filters.append(WhatsAppMessage.job_id == job_id)
    if event_key:
        filters.append(WhatsAppMessage.event_key == event_key)
    if template_name:
        filters.append(WhatsAppMessage.template_name == template_name)

    total = (
        await db.execute(
            select(func.count()).select_from(WhatsAppMessage).where(*filters)
        )
    ).scalar_one()

    rows = (
        await db.execute(
            select(WhatsAppMessage, User.name, Job.code)
            .outerjoin(User, User.id == WhatsAppMessage.user_id)
            .outerjoin(Job, Job.id == WhatsAppMessage.job_id)
            .where(*filters)
            # `id` as a tiebreak: a tied sort lets the database order rows
            # differently per page, which shows one row twice and hides another
            # (docs/07).
            .order_by(WhatsAppMessage.created_at.desc(), WhatsAppMessage.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()

    return Page[MessageRead](
        items=[
            MessageRead(
                id=m.id,
                user_id=m.user_id,
                user_name=user_name,
                job_id=m.job_id,
                job_code=job_code,
                event_key=m.event_key,
                template_name=m.template_name,
                to_phone=phone.display(m.to_phone),
                status=m.status,
                reason=m.reason,
                error_code=m.error_code,
                error_detail=m.error_detail,
                button_action=m.button_action,
                button_tapped_at=m.button_tapped_at,
                sent_at=m.sent_at,
                delivered_at=m.delivered_at,
                read_at=m.read_at,
                failed_at=m.failed_at,
                created_at=m.created_at,
            )
            for m, user_name, job_code in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/messages/stats", response_model=MessageStats)
async def message_stats(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Counted over the window, not over a page (docs/07)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        await db.execute(
            select(WhatsAppMessage.status, func.count())
            .where(WhatsAppMessage.created_at >= since)
            .group_by(WhatsAppMessage.status)
        )
    ).all()
    counts = {status_name: count for status_name, count in rows}
    # A row holds only its latest receipt, so the tiles add up as a funnel:
    # a read message was also delivered, and a delivered one was also sent.
    return MessageStats(
        sent=counts.get("sent", 0) + counts.get("delivered", 0) + counts.get("read", 0),
        delivered=counts.get("delivered", 0) + counts.get("read", 0),
        read=counts.get("read", 0),
        failed=counts.get("failed", 0),
        skipped=counts.get("skipped", 0),
    )


# --------------------------------------------------------------------------
# Numbers
# --------------------------------------------------------------------------


@router.get("/numbers", response_model=list[NumberRead])
async def list_numbers(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Who can actually be reached, and who cannot.

    The tab that quietly saves the rollout. Six people with no usable number
    means six people silently missing every hand-off, and nothing else in the
    product would ever say so — a notification that was never sent leaves no
    trace anywhere a person looks.
    """
    users = (
        (await db.execute(select(User).where(User.is_active.is_(True)).order_by(User.name)))
        .scalars()
        .all()
    )
    seen: dict[str, int] = {}
    for user in users:
        if user.phone_e164:
            seen[user.phone_e164] = seen.get(user.phone_e164, 0) + 1

    now = datetime.now(timezone.utc)
    out = []
    for user in users:
        valid = phone.is_valid(user.phone_e164)
        duplicate = bool(user.phone_e164) and seen.get(user.phone_e164, 0) > 1
        window_open = bool(
            user.last_inbound_at and now - user.last_inbound_at < SERVICE_WINDOW
        )
        out.append(
            NumberRead(
                user_id=user.id,
                name=user.name,
                email=user.email,
                role=user.role,
                is_active=user.is_active,
                phone=user.phone,
                phone_e164=user.phone_e164,
                phone_display=phone.display(user.phone_e164),
                valid=valid,
                opt_in=user.whatsapp_opt_in,
                last_inbound_at=user.last_inbound_at,
                window_open=window_open,
                duplicate=duplicate,
                reachable=valid and user.whatsapp_opt_in and not duplicate,
            )
        )
    return out


@router.patch("/numbers/{user_id}", response_model=NumberRead)
async def update_number(
    user_id: uuid.UUID,
    payload: NumberUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Set consent, and/or re-derive the dialable number from what was typed."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.opt_in is not None:
        user.whatsapp_opt_in = payload.opt_in
    if payload.renormalise:
        user.phone_e164 = phone.normalise(user.phone)
    await db.commit()
    await db.refresh(user)

    duplicates = (
        await db.execute(
            select(func.count())
            .select_from(User)
            .where(User.phone_e164 == user.phone_e164, User.is_active.is_(True))
        )
    ).scalar_one() if user.phone_e164 else 0
    now = datetime.now(timezone.utc)
    valid = phone.is_valid(user.phone_e164)
    return NumberRead(
        user_id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        phone=user.phone,
        phone_e164=user.phone_e164,
        phone_display=phone.display(user.phone_e164),
        valid=valid,
        opt_in=user.whatsapp_opt_in,
        last_inbound_at=user.last_inbound_at,
        window_open=bool(user.last_inbound_at and now - user.last_inbound_at < SERVICE_WINDOW),
        duplicate=duplicates > 1,
        reachable=valid and user.whatsapp_opt_in and duplicates <= 1,
    )


# --------------------------------------------------------------------------
# Test send and manual scheduler run
# --------------------------------------------------------------------------


@router.post("/test-send", response_model=TestSendResult)
async def test_send(
    payload: TestSendRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Send one template to yourself, through the real guard rails.

    Deliberately *not* a bypass. It runs `send_template` exactly as a stage
    change would, so "nothing arrived" is diagnosed here — opted out, no
    number, template still in review — rather than after a real hand-off goes
    missing. The example values from the registry stand in for the parameters.
    """
    _require_configured()
    spec = registry.get(payload.template_name)
    if spec is None:
        raise HTTPException(
            status_code=404, detail=f"No template named '{payload.template_name}'"
        )
    recipient = user
    if payload.user_id:
        found = await db.get(User, payload.user_id)
        if found is None:
            raise HTTPException(status_code=404, detail="User not found")
        recipient = found

    # The registry's own examples, positionally — so a test exercises the same
    # parameter count the real send will use.
    context = _example_context(spec, recipient)
    message = await send.send_template(
        db,
        recipient=recipient,
        template_name=spec.name,
        context=context,
        event_key="admin:test",
        job=None,
    )
    await db.commit()
    return TestSendResult(
        status=message.status,
        reason=message.reason,
        error_code=message.error_code,
        error_detail=message.error_detail,
        wamid=message.wamid,
        to_phone=phone.display(message.to_phone),
    )


def _example_context(spec: registry.TemplateSpec, recipient: User) -> dict:
    """A context whose every key is covered by the registry's own examples.

    `params()` reads named keys, and each template reads a different set, so
    the safest stand-in is every key any of them uses — filled from the
    examples where the position lines up and left as a placeholder otherwise.
    The recipient's real name goes in so the greeting is recognisably a test
    addressed to the person holding the phone.
    """
    examples = list(spec.examples)

    def at(index: int, fallback: str) -> str:
        return examples[index] if index < len(examples) else fallback

    return {
        "recipient_name": recipient.name or "there",
        "actor_name": at(1, "Kontent OS"),
        "job_code": "TEST-0001",
        "job_title": "Test message from the admin page",
        "pod_name": at(3, "Test pod"),
        "video_type": "Short form",
        "deadline": "today",
        "round": 1,
        "stage_label": "Editing",
        "from_stage_label": "QC 2",
        "note": "This is a test send from the Kontent OS admin page.",
        "points": 1,
        "editor_name": recipient.name or "—",
        "open_count": "1 job",
        "overdue_count": 0,
        "due_soon_count": 1,
        "next_job": "TEST-0001 — Test message",
        "job_url": f"{get_settings().frontend_base_url.rstrip('/')}/jobs/test",
        "tl_name": "Team Lead",
    }


@router.post("/scheduler/run", response_model=SchedulerRunResult)
async def run_scheduler(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role(*ADMIN_ROLES)),
):
    """Run the hourly pass now — reconcile, then the date-driven messages.

    The same `run_once` the background loop calls, so the button and the loop
    cannot drift into doing different things.
    """
    _require_configured()
    result = await scheduler.run_once(db)
    await db.commit()
    return SchedulerRunResult(**result)


@router.get("/me", response_model=NumberRead)
async def my_whatsapp_state(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """A person's own number and consent — the one route here that is not
    owner-gated, because it returns nothing but the caller's own row.

    It backs the opt-in control on a profile: consent that only an Owner can
    record is consent nobody gives.
    """
    now = datetime.now(timezone.utc)
    valid = phone.is_valid(user.phone_e164)
    return NumberRead(
        user_id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        phone=user.phone,
        phone_e164=user.phone_e164,
        phone_display=phone.display(user.phone_e164),
        valid=valid,
        opt_in=user.whatsapp_opt_in,
        last_inbound_at=user.last_inbound_at,
        window_open=bool(user.last_inbound_at and now - user.last_inbound_at < SERVICE_WINDOW),
        duplicate=False,
        reachable=valid and user.whatsapp_opt_in,
    )


@router.patch("/me", response_model=NumberRead)
async def update_my_whatsapp_state(
    payload: NumberUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Opt yourself in or out. Own row only — `user` comes from the token."""
    if payload.opt_in is not None:
        user.whatsapp_opt_in = payload.opt_in
    if payload.renormalise:
        user.phone_e164 = phone.normalise(user.phone)
    await db.commit()
    await db.refresh(user)
    return await my_whatsapp_state(db=db, user=user)
