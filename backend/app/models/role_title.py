import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RoleTitle(Base):
    """What somebody is called, when the pipeline has no word for it —
    "Graphic Designer", "Social Media", "Motion".

    A title is not a permission and cannot become one: the account behind it
    is `role='staff'`, which grants nothing, and anything it *can* do comes
    from a `secondary_role` an Owner handed over on purpose. Keeping the two
    apart is the whole design — a company hires faster than a permission model
    changes, and the old answer was to file a designer under "VE" so the form
    would accept them, which put them in editor pickers and QC routing.

    A row rather than a string on the user so the tenth designer is the same
    word as the first. `name` is unique case-insensitively for the same
    reason — "Graphic Designer" and "graphic designer" are one title, and a
    roster filtered by title has to agree.
    """

    __tablename__ = "role_titles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60))
    # Retired rather than deleted: accounts keep pointing at it, and a title
    # nobody holds any more is still the honest answer to "what was this
    # person called". Hidden from the picker, kept on the record.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
