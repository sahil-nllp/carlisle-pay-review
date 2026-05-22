"""Site-level approval tracking — regional submit → senior approve."""
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class ApprovalStatus(StrEnum):
    NOT_SUBMITTED = "not_submitted"
    PENDING = "pending"
    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"


class Approval(Base, TimestampMixin):
    __tablename__ = "approvals"
    __table_args__ = (
        UniqueConstraint("cycle_id", "site", name="uq_approval_cycle_site"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(
        ForeignKey("review_cycles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    site: Mapped[str] = mapped_column(String(120), nullable=False)

    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=ApprovalStatus.NOT_SUBMITTED.value
    )

    # Step 1: Regional manager submits
    submitted_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    submission_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Step 2: Senior management approves / requests changes
    decided_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decision_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Approval cycle={self.cycle_id} site={self.site} status={self.status}>"
