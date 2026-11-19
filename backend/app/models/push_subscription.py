import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PushSubscription(Base):
    """One browser, on one device, that has agreed to be interrupted.

    The in-app chime only reaches somebody already looking at the app. A
    15-second poll is throttled to about a minute in a background tab and
    harder still behind a minimised window, so the one moment the sound
    matters — the app is behind Premiere — is the one moment it does not
    arrive. That is not fixable by polling faster; the alert has to come from
    outside the page, which is what the Web Push protocol is.

    A row per *browser*, not per person: the same editor on a desktop and a
    laptop is two subscriptions and should be interrupted on both. `endpoint`
    is the push service's URL for that browser and is the natural key —
    re-subscribing the same browser returns the same endpoint, so it is unique
    and re-registration updates rather than accumulating.

    `p256dh` and `auth` are the browser's public key and shared secret; the
    payload is encrypted to them, which is why a push service can carry the
    message without being able to read it. They are useless to anyone else
    and are not a credential for this app.

    Rows are deleted, not deactivated — the mirror image of `users`. A dead
    subscription answers 404 or 410 forever and has no history worth keeping
    (`services/push.py` drops it on the first such answer).
    """

    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    # Text, not String(n): these are long, and the push services have changed
    # their shape before. A truncated endpoint is a subscription that fails
    # silently forever.
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    # Only so somebody can tell "my laptop" from "my phone" when turning one
    # off. Never parsed.
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Bumped every time the browser re-registers, which it does on every load.
    # A subscription nobody has opened in months is a stale row to prune, not
    # an error to chase.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
