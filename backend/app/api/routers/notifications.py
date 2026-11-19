import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user
from app.db.session import async_session_factory, get_db
from app.models.job import Job
from app.models.brand_kit_event import BrandKitEvent
from app.models.job_event import JobEvent
from app.models.notification import Notification
from app.models.pod import Pod
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.schemas.notification import (
    NotificationListResponse,
    NotificationRead,
    PushKeyRead,
    PushSubscriptionCreate,
    PushTestResult,
)
from app.services.notification_text import body_for, brand_headline_for, headline_for
from app.services.push import push_enabled, send_to_user

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Live references to the delayed test sends. asyncio holds only a weak one,
# so a task nobody references can be collected during its own sleep — the
# test button would then work under load and silently not under test.
_test_pushes: set[asyncio.Task] = set()


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    unread_only: bool = False,
    event_type: str | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Own notifications only, newest first. Joined with the event, its job,
    that job's pod and the actor, so a row can say "Farah raised changes on
    KM-1042 — Dhan" in one round-trip instead of "Job stage changed".

    Filtered and paged in SQL. The unread count comes back separately and
    counts the whole inbox: the bell used to derive it from whatever the
    first fifty rows happened to contain, so a busy inbox under-reported."""
    scope: list = [Notification.user_id == user.id]

    filters = list(scope)
    if unread_only:
        filters.append(Notification.read_at.is_(None))
    if event_type:
        filters.append(BrandKitEvent.id.is_not(None) if event_type == "brand_kit_updated" else JobEvent.event_type == event_type)
    if search:
        term = f"%{search.strip()}%"
        filters.append(or_(Job.title.ilike(term), Job.code.ilike(term), BrandKitEvent.title.ilike(term), Pod.name.ilike(term)))

    def joined(stmt):
        return (
            stmt.outerjoin(JobEvent, JobEvent.id == Notification.event_id)
            .outerjoin(Job, Job.id == JobEvent.job_id)
            .outerjoin(BrandKitEvent, BrandKitEvent.id == Notification.brand_event_id)
            .join(Pod, Pod.id == func.coalesce(Job.pod_id, BrandKitEvent.pod_id))
        )

    total = (
        await db.execute(joined(select(func.count()).select_from(Notification)).where(*filters))
    ).scalar_one()
    unread = (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(*scope, Notification.read_at.is_(None))
        )
    ).scalar_one()

    result = await db.execute(
        joined(select(Notification, JobEvent, Job, BrandKitEvent, Pod.id, Pod.name, User.name))
        .outerjoin(User, User.id == func.coalesce(JobEvent.actor_id, BrandKitEvent.actor_id))
        .where(*filters)
        # created_at has second-level ties on a burst of notifications from
        # one stage change; the id keeps paging stable through them.
        .order_by(Notification.created_at.desc(), Notification.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = []
    for notification, event, job, brand_event, pod_id, pod_name, actor_name in result.all():
        if brand_event:
            items.append(NotificationRead(
                id=notification.id, channel=notification.channel, read_at=notification.read_at,
                created_at=notification.created_at, job_id=None, pod_id=pod_id,
                event_type="brand_kit_updated", job_code="", job_title=brand_event.title,
                pod_name=pod_name, actor_name=actor_name, note=brand_event.note,
                headline=brand_headline_for(action=brand_event.action, actor_name=actor_name, title=brand_event.title, pod_name=pod_name),
                body=body_for(job_title=brand_event.title, pod_name=pod_name, note=brand_event.note),
            ))
            continue
        items.append(NotificationRead(
            id=notification.id,
            channel=notification.channel,
            read_at=notification.read_at,
            created_at=notification.created_at,
            job_id=event.job_id,
            pod_id=pod_id,
            event_type=event.event_type,
            job_code=job.code,
            job_title=job.title,
            pod_name=pod_name,
            stage=event.payload.get("stage"),
            actor_name=actor_name,
            # A scrap carries its `reason` where everything else carries a
            # `note`. Both are "what the person typed", and the inbox row is
            # useless for a scrap without it — "X scrapped KM-1042" with no
            # why is a message that guarantees a follow-up question.
            note=event.payload.get("note") or event.payload.get("reason"),
            headline=headline_for(
                event_type=event.event_type,
                job_code=job.code,
                actor_name=actor_name,
                stage=event.payload.get("stage"),
            ),
            body=body_for(
                job_title=job.title,
                pod_name=pod_name,
                note=event.payload.get("note") or event.payload.get("reason"),
            ),
        ))
    return NotificationListResponse(
        items=items, total=total, page=page, page_size=page_size, unread=unread
    )


@router.get("/push/key", response_model=PushKeyRead)
async def get_push_key(_: User = Depends(get_current_user)):
    """The VAPID public key a browser needs before it can subscribe.

    Also says whether push is configured at all, so the UI can offer "turn on
    desktop alerts" or explain that this deployment has no keys yet — rather
    than showing a button that asks for a browser permission it then cannot
    use.

    Registered before `/{notification_id}/read` so "push" is never parsed as a
    uuid — same reason `/stats` sits above `/{user_id}` in the users router."""
    settings = get_settings()
    return PushKeyRead(public_key=settings.vapid_public_key, enabled=push_enabled())


@router.post("/push/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def subscribe_to_push(
    payload: PushSubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Register this browser for desktop notifications.

    Idempotent on `endpoint`, which is the browser's own stable id for its
    subscription: the frontend calls this on every load, and without the
    upsert each load would add a row and every notification would arrive as
    many times as the app had been opened.

    An endpoint that already belongs to somebody else is **reassigned**, not
    refused. That is a shared machine where a second person has logged in, and
    a browser has exactly one subscription to give — leaving it pointed at the
    previous account would push one person's work to another person's screen.
    """
    if not push_enabled():
        raise HTTPException(
            status_code=503,
            detail="Desktop notifications are not set up on this server yet",
        )
    existing = (
        await db.execute(
            select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if existing is not None:
        existing.user_id = user.id
        existing.p256dh = payload.p256dh
        existing.auth = payload.auth
        existing.user_agent = payload.user_agent
        existing.last_seen_at = now
    else:
        db.add(
            PushSubscription(
                user_id=user.id,
                endpoint=payload.endpoint,
                p256dh=payload.p256dh,
                auth=payload.auth,
                user_agent=payload.user_agent,
                last_seen_at=now,
            )
        )
    await db.commit()


@router.post("/push/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe_from_push(
    payload: PushSubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Turn desktop alerts off for this browser.

    Scoped to the caller's own rows. Without that, an endpoint string — which
    a browser hands to any page on the origin — would be enough to silence
    somebody else's notifications."""
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == payload.endpoint,
            PushSubscription.user_id == user.id,
        )
    )
    await db.commit()


@router.post("/push/test", response_model=PushTestResult)
async def send_test_push(
    delay_seconds: int = Query(5, ge=0, le=30),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Push a test alert to the caller's own browsers, after a delay.

    The delay is the feature. What anybody actually wants to check is whether
    a notification reaches them once the window is *behind* something else,
    and you cannot minimise a window and press a button at the same time. Five
    seconds is enough to get out of the way; the cap is thirty, because a test
    you have to wait a minute for is one nobody runs twice.

    Only ever the caller's own subscriptions. A test alert that could be aimed
    at somebody else is a way to ring a colleague's laptop at will.

    Returns how many browsers it went to, which is the answer when nothing is
    heard: zero means the subscription never registered, and anything above
    zero moves the question to the operating system's notification settings.
    """
    if not push_enabled():
        raise HTTPException(
            status_code=503,
            detail="Desktop notifications are not set up on this server yet",
        )
    count = (
        await db.execute(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.user_id == user.id)
        )
    ).scalar_one()
    if count == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "This browser is not registered for desktop alerts yet — turn them on first"
            ),
        )

    async def later(user_id: uuid.UUID):
        await asyncio.sleep(delay_seconds)
        async with async_session_factory() as session:
            await send_to_user(
                session,
                user_id=user_id,
                title="Test alert from Kontent OS",
                body="If you can hear this, notifications are working.",
                url="/notifications",
                # A fixed tag, so pressing the button four times leaves one
                # notification on screen rather than a stack of identical ones.
                tag="kontent-os-test",
            )
            await session.commit()

    task = asyncio.create_task(later(user.id))
    _test_pushes.add(task)
    task.add_done_callback(_test_pushes.discard)
    return PushTestResult(sent_to=count, delay_seconds=delay_seconds)


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """One request instead of one per row. "Mark all read" fired a POST for
    every unread notification it had *loaded*, which meant it both hammered
    the API and quietly left anything past the first page unread."""
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = await db.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.read_at = datetime.now(timezone.utc)
    await db.commit()
