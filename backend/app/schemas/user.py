import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.common import Page

Role = Literal["owner", "tl", "qc", "ve", "hr", "fo", "staff"]

# What may be lent on top of somebody's own role. Mirrors `SECONDARY_ROLES` in
# models/user.py, which is the enforcement, and is a Literal of one on purpose
# — see the reasoning there.
SecondaryRole = Literal["tl"]

# Mirrors `EMPLOYMENT_TYPES` in models/user.py, which is the enforcement.
# Only a QC reviewer's routing reads it — it is the QC2 points budget, and
# nothing else in the product asks how long somebody's day is.
EmploymentType = Literal["full_time", "part_time"]

# Which roles each account-creating role may hand out — on `POST /users` and
# on a role change through `PATCH /users/{id}`, because they are the same
# power: setting a role to `owner` on an account whose password you also
# control is the same thing as creating an Owner. Roles absent from this map
# (TL, QC, VE) create nobody.
#
# - **Owner** hands out anything, including the admin tier itself.
# - **HR** onboards the people who do the work, plus `staff` — anyone the
#   pipeline has no word for, who is then called what they actually are
#   (`role_title`). It hands out nothing that administers anything, and it
#   cannot mint another HR: growing people-ops is an Owner decision.
#
# The Founder's Office is absent, and that is the change: it onboarded four
# roles when it was an Owner everywhere. It now holds what it was given — a
# TL secondary on its own pods — and creating accounts is not part of that.
#
# See docs/04-permissions.md.
CREATABLE_ROLES: dict[str, tuple[str, ...]] = {
    "owner": ("owner", "tl", "qc", "ve", "hr", "fo", "staff"),
    "hr": ("tl", "qc", "ve", "staff"),
}

# One password rule, defined once. Account creation used to accept a
# two-character password while the reset endpoint demanded eight; the only
# thing enforcing 8 on new accounts was a minLength attribute in the browser.
PASSWORD_MIN_LENGTH = 8


class AccountStatusEvent(BaseModel):
    """The last thing that happened to an account's on/off switch, for the
    line under a name in the directory."""

    model_config = ConfigDict(from_attributes=True)

    action: Literal["deactivated", "reactivated"]
    actor_name: str | None = None
    reason: str | None = None
    created_at: datetime


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: EmailStr
    role: str
    # What this person is called, when their role has no word for it. Null on
    # the built-in roles, which carry their own names.
    role_title: str | None = None
    secondary_role: str | None = None
    phone: str | None = None
    available: bool
    is_active: bool = True
    # How many videos this editor may hold at once, enforced on every
    # assignment path (models/user.py). Present on every account because the
    # admin screen edits it in one place, but it only means anything for a VE.
    max_concurrent_jobs: int = 5
    # Full day or half day. The QC2 points budget is derived from it and never
    # sent alongside — see `QcLoadRead.capacity`, which is where the derived
    # number belongs. Present on every account for the same reason
    # `max_concurrent_jobs` is: the admin screen edits one row at a time.
    employment_type: EmploymentType = "full_time"
    # The last thing that happened to this account's on/off switch, so a
    # greyed-out row can say who switched it off and when instead of just
    # being grey. Null on every account nobody has ever switched, which is
    # most of them, and on every row that predates `user_events`.
    last_status_change: AccountStatusEvent | None = None


class UserListResponse(Page[UserRead]):
    """One page of the account directory, plus the count behind it."""


class RoleCount(BaseModel):
    total: int
    inactive: int


class RoleTitleRead(BaseModel):
    """A job title the roster already knows — what the onboarding form's
    dropdown is built from."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class UserDirectoryStats(BaseModel):
    """Roster totals for the tiles above the directory. Separate from the
    list because they count the whole roster while the list counts one
    filtered page — deriving them from the page would have made every tile
    change as you typed in the search box."""

    active: int
    inactive: int
    by_role: dict[str, RoleCount]


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)
    role: Role
    phone: str | None = None
    # A job title for the roles the pipeline has no word for. Send either an
    # existing `role_title_id` or a new `role_title` to create-or-reuse one by
    # name; both are only meaningful on a `staff` account, which is what
    # "custom role" means underneath.
    role_title_id: uuid.UUID | None = None
    role_title: str | None = Field(default=None, min_length=1, max_length=60)
    # Borrowed powers, granted deliberately and separately from the job title.
    secondary_role: SecondaryRole | None = None
    # Asked at onboarding for QC accounts, where it decides the day's points
    # budget from the first job they are routed. Defaulted rather than required
    # so onboarding a designer does not ask a question that means nothing.
    employment_type: EmploymentType = "full_time"


class UserUpdate(BaseModel):
    """Owner account admin; HR may edit only name, email and phone.

    `is_active=False` is how someone who leaves
    is switched off — their history stays intact (it's referenced by every
    job they touched), they simply can't log in again.

    HR reaches the same switch through `POST /users/{id}/deactivate`, which is
    that one power on its own rather than this route's whole keyring — see
    docs/04-permissions.md. Both write the same `user_events` row."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    phone: str | None = None
    role: Role | None = None
    role_title_id: uuid.UUID | None = None
    role_title: str | None = Field(default=None, min_length=1, max_length=60)
    secondary_role: SecondaryRole | None = None
    # Sent explicitly to take a lent role back, since None means "not sent" —
    # the same shape as `clear_deadline` on a job.
    clear_secondary_role: bool = False
    clear_role_title: bool = False
    # Zero is a legitimate setting — "assign nothing new to this person" —
    # and it is not the same as deactivating them.
    max_concurrent_jobs: int | None = Field(default=None, ge=0, le=100)
    employment_type: EmploymentType | None = None
    available: bool | None = None
    is_active: bool | None = None


class DeactivationRequest(BaseModel):
    """Why an account is being switched off.

    Optional, and optional on purpose: a required box gets "left" typed into
    it a hundred times, which is worth no more than a blank one. The row in
    `user_events` is written either way — the fact worth keeping is who did
    it, and the reason is a bonus when somebody bothers.
    """

    reason: str | None = Field(default=None, max_length=500)


class OpenWorkSummary(BaseModel):
    """What is still on somebody's plate, as two numbers and nothing else.

    Read before switching an account off, because deactivation does not
    unassign anything — it just makes the person holding it unreachable. The
    counts are deliberately all it returns: HR may see *that* four videos are
    stranded without being handed a list of which client's work they are
    (docs/04 — HR reads the roster, not the board).
    """

    editing: int
    reviewing: int
    leading_pods: int


class AvailabilityUpdate(BaseModel):
    """Self-service routing toggle — see docs/04-permissions.md."""

    available: bool


class PasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH)


class UserCapacity(BaseModel):
    user_id: uuid.UUID
    name: str
    # Videos held right now. An editor's cap is a count of concurrent jobs, so
    # this is the number that belongs beside `max_concurrent_jobs` — the two
    # used to be drawn against each other while one of them was in weight
    # points, which tinted a three-job editor red against a cap of five.
    open_count: int
    weighted_load: float
    max_concurrent_jobs: int


class VELoadRead(BaseModel):
    user_id: uuid.UUID
    name: str
    assigned_count: int
    completed_count: int
    weighted_load: float
    max_concurrent_jobs: int
    # `max_concurrent_jobs - assigned_count`, floored at zero. Sent rather
    # than left to the browser so the picker and the check that rejects a
    # full editor are working off one number.
    free_slots: int


class PodJobCount(BaseModel):
    pod_id: uuid.UUID
    pod_name: str
    count: int


class EditorCapacityRead(BaseModel):
    user_id: uuid.UUID
    name: str
    open_by_pod: list[PodJobCount]
    open_count: int
    delivered_count: int
    clean_pct: float | None
    weighted_load: float
    max_concurrent_jobs: int
    free_slots: int
    reachable_free: bool


class CapacityJobRead(BaseModel):
    id: uuid.UUID
    code: str
    title: str
    stage: str
    video_type: str
    deadline: date | None
    rush: bool
    pod_name: str
    editor_id: uuid.UUID | None
    editor_name: str | None
    tl_name: str | None
    qc_id: uuid.UUID | None
    qc_name: str | None


class QcLoadRead(BaseModel):
    """One reviewer's day, in points (docs/12-qc2-load-model.md).

    This replaced a `weighted_load` against a single company-wide
    `capacity_cap`. That shape could not describe the model it was reporting
    on: one cap for everybody meant a part-timer was drawn as half-full when
    they were done for the day, and a single load number could not say which
    part of it was today's work and which was Monday's, still open.
    """

    user_id: uuid.UUID
    name: str
    available: bool
    employment_type: str
    # Derived from `employment_type`, never stored — see `routing.CAPACITY`.
    capacity: int

    # `points_today` and `points_carried` partition `load`: rows dated today,
    # and still-open rows from earlier days. Sent split rather than as one
    # number because they mean different things to the person reading them —
    # one is what they have done, the other is what they are behind on — and
    # summed rather than re-derived in the browser.
    points_today: int
    points_carried: int
    load: int
    points_left: int

    open_count: int
    # Charges in the load window, by kind of video: {"long_form": 2, ...}.
    videos_by_type: dict[str, int]
    podcasts_held: int
    # Sent rather than computed client-side because two separate rules feed it
    # — points left, and `PART_TIME_PODCAST_MAX` — and only the first is
    # visible in the numbers above. A screen deriving it from `points_left`
    # alone would tell a part-timer with 12 free points that they can take a
    # second podcast.
    can_take_podcast: bool

    cleared_count: int
    status: str
