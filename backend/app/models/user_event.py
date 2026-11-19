import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# What was done to the account. Deliberately only the two: this table exists
# because the off-switch left the admin tier, not as a general-purpose audit
# log for every field on a user. A rename does not need a row; locking
# somebody out of the company's tooling does.
USER_ACTIONS = ("deactivated", "reactivated")


class UserEvent(Base):
    """Who switched whose account off, when, and why.

    HR can now deactivate the roles it onboards (`schemas/user.py::
    CREATABLE_ROLES`), which used to be the Owner's alone. The moment more
    than one person can lock someone out of the company's tooling, "who did
    this" stops having an obvious answer — and `users.is_active` is a boolean
    that remembers nothing about how it got that way.

    Deliberately not modelled on `JobEvent`. That one is an append-only
    narrative of a job with a free-form payload, because a job has a dozen
    kinds of thing happen to it. An account has one: it was switched off, or
    back on. Two named columns and a reason read better than a JSON blob
    nobody can query, and there is no second use waiting for the generality.
    """

    __tablename__ = "user_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # The account this was done *to*. Indexed because the only read this table
    # has is "the latest row for this person", once per directory row.
    target_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True
    )
    # Nullable so the actor can be deactivated later without taking the record
    # of what they did with them — `ondelete` is moot here since users are
    # never deleted, but a leaver's own rows must not become unreadable.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(Enum(*USER_ACTIONS, name="user_event_action"))
    # Optional, and optional on purpose: requiring a reason would get "left"
    # typed into it a hundred times, which is worth no more than a blank.
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
