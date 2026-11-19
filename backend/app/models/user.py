import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# The roles the *permission system* knows about. A person's job title is a
# separate thing entirely — see `RoleTitle` and `User.role_title_id`: a
# Graphic Designer or a Social Media manager is `staff` here, which grants
# nothing, and is called what they actually are on every screen.
#
# `staff` is that role: an account with no powers at all beyond its own
# profile and its own notifications. It is the floor everybody starts from,
# and permissions are added to it deliberately (`secondary_role`) rather than
# inherited from a title someone typed.
ROLES = ("owner", "tl", "qc", "ve", "hr", "fo", "staff")

# What may be handed out as a *second* role on top of somebody's own.
#
# Only TL, and only TL for a reason: a Team Lead's powers are already scoped
# to `Pod.tl_id`, so granting it hands over exactly the pods the Owner points
# at and nothing else. An editor who runs two client pods, an HR who onboards
# their own clients, the Founder's Office — all of them are "their own role,
# plus TL on the pods they were given". Nothing else in the product is
# per-pod like that, so nothing else is safe to lend.
SECONDARY_ROLES: tuple[str, ...] = ("tl",)

# How long somebody's working day is. It buys nothing and gates nothing except
# the QC2 points budget (`services/routing.py::CAPACITY`), which is why it is a
# two-value enum and not a number of hours: the product has one question to ask
# of it — is this a full day or half of one — and a free-text figure would
# invite a third answer nothing knows how to price.
EMPLOYMENT_TYPES = ("full_time", "part_time")

# The admin tier: the Owner, and only the Owner. Accounts, roles, password
# resets, impersonation, deactivation.
#
# The Founder's Office used to sit here and no longer does. It reaches the
# work the same way anyone else does now — as a TL of the pods it was given
# (`secondary_role`), which is what migration 0017 gave every existing FO
# account. The reasoning is the whole point of this file: reach over the work
# comes from being handed pods, not from a role name that quietly means
# "everything".
ADMIN_ROLES: tuple[str, ...] = ("owner",)

# Roles that pod scoping does not apply to: every pod, every job, every
# analytic, company-wide, with no membership row required. The Owner alone.
#
# HR was here and is not any more. HR onboards people and reads the roster —
# that is the whole of it (`routers/users.py`). An HR who is also meant to run
# client work gets `secondary_role='tl'` and the pods to go with it, and then
# holds a TL's powers *there*, visibly, instead of holding them everywhere by
# implication.
ALL_PODS_ROLES: tuple[str, ...] = ADMIN_ROLES

# Everyone who leads work at all — the Owner, plus TLs on the pods they lead.
# `require_role(*LEAD_ROLES)` is the coarse gate; `check_pod_lead` and the
# scope clauses in services/access.py do the per-pod narrowing.
#
# Read this against `effective_roles` below, not against `User.role`: a person
# with a TL secondary is a lead here, whatever their own role says.
LEAD_ROLES: tuple[str, ...] = (*ALL_PODS_ROLES, "tl")


def effective_roles(user: "User") -> frozenset[str]:
    """Every role this person actually holds — their own, plus a secondary if
    they were given one.

    The one function to ask "is this person a TL?" through. `user.role == 'tl'`
    is now wrong on its face: an editor with a TL secondary is a real TL on
    their own pods, and an HR with one onboards clients and runs them. Both
    are the point of the feature, and both are invisible to a `==`.
    """
    if user.secondary_role:
        return frozenset({user.role, user.secondary_role})
    return frozenset({user.role})


def has_role(user: "User", *roles: str) -> bool:
    """Does this person hold any of `roles`, primary or secondary?"""
    return bool(effective_roles(user) & set(roles))


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # The same number, normalised to E.164 without the plus — "919876543210".
    # Derived from `phone` on every write (`services/whatsapp/phone.py`) and
    # kept beside it rather than replacing it, because normalisation guesses:
    # a bare ten-digit number gets the default country code, and when that
    # guess is wrong somebody has to be able to see what was actually typed.
    # This is the only field the WhatsApp sender dials; `phone` stays the
    # human's version, for the roster and for the phone in someone's hand.
    phone_e164: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Consent, on the record. These are colleagues rather than customers and
    # the messages are all work, but WhatsApp policy asks for opt-in either
    # way, and an account that has not given it is skipped with a reason
    # instead of silently missing its hand-offs.
    whatsapp_opt_in: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    # When this person last messaged the business number, which is what opens
    # Meta's 24-hour customer-service window. Inside it a reply is free-form
    # and free; outside it only an approved template will send at all. Written
    # by the inbound webhook as a first-class fact, not as a logging side
    # effect — every send decision reads it.
    last_inbound_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    role: Mapped[str] = mapped_column(Enum(*ROLES, name="user_role"))
    # Borrowed powers, on top of `role`. Today the only legal value is `tl`
    # (SECONDARY_ROLES) and it means "a real Team Lead on the pods whose
    # `Pod.tl_id` is me" — not a second job, a second set of keys. Read it
    # through `effective_roles`, never directly.
    secondary_role: Mapped[str | None] = mapped_column(
        ENUM(*ROLES, name="user_role", create_type=False), nullable=True
    )
    # What this person is *called*: "Graphic Designer", "Social Media". Null
    # for the built-in roles, which carry their own names. A title grants
    # nothing — it exists so the roster can describe someone the pipeline has
    # no word for, instead of filing them under a role that would.
    role_title_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("role_titles.id"), nullable=True
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("teams.id"), nullable=True)
    # How many videos this editor may hold at once — a hard cap, not a
    # forecast. It replaced `capacity_per_week` (a weighted per-week number)
    # because nothing ever enforced that one: the number sat on the admin
    # screen while assignment went straight past it, so editors quietly ended
    # up with twenty open jobs. A slot frees when a job is delivered, which is
    # the only moment the work is actually off their plate — see
    # `services/access.py::ensure_assignable_editor`, the single place the
    # cap is checked.
    max_concurrent_jobs: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    # Full day or half day. The QC2 points budget is *derived* from this
    # (`services/routing.py::CAPACITY`) and deliberately never stored per
    # account: change what a part-time day is worth and it changes for
    # everybody at once, rather than for whoever gets edited. Present on every
    # account because the admin screen edits one row at a time, but only a QC
    # reviewer's routing reads it.
    employment_type: Mapped[str] = mapped_column(
        Enum(*EMPLOYMENT_TYPES, name="user_employment_type"),
        default="full_time",
        server_default="full_time",
    )
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    # Account switch, not the routing toggle above: `available` means "don't
    # route new QC work to me today", `is_active` means "this person has left
    # and cannot log in". Rows are never deleted — every job they touched
    # references them — so leavers are deactivated, see docs/03-data-model.md.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    team: Mapped["Team | None"] = relationship(back_populates="members", foreign_keys=[team_id])
    # Eager by default: every roster read prints the title next to the name,
    # and a lazy load here is a `MissingGreenlet` in async SQLAlchemy rather
    # than a slow query — the failure mode is a 500, not a delay.
    # `foreign_keys` is not optional here: role_titles.created_by_id points
    # back at users, so there are two paths between the tables and SQLAlchemy
    # refuses to guess.
    title: Mapped["RoleTitle | None"] = relationship(
        lazy="selectin", foreign_keys=[role_title_id]
    )

    @property
    def role_title(self) -> str | None:
        """The title as a plain string, for the API schema and for anything
        printing "who is this" without wanting a second object."""
        return self.title.name if self.title else None
