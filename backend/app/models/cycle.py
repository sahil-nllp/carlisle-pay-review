"""Review cycle — one per financial year."""
from datetime import date
from enum import StrEnum

from sqlalchemy import Date, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class CycleStatus(StrEnum):
    DRAFT = "draft"           # Wage model uploaded, not yet rolled out
    ACTIVE = "active"         # Review in progress
    LOCKED = "locked"         # All approvals done, generating outputs
    COMPLETED = "completed"   # Letters sent, payroll uploaded
    ARCHIVED = "archived"     # Past cycle kept for reference


class ReviewCycle(Base, TimestampMixin):
    __tablename__ = "review_cycles"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Identity
    fy_label: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    # e.g. "FY2026-27"

    # Key dates
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    letter_date: Mapped[date] = mapped_column(Date, nullable=False)
    consultation_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Rates / config (annual)
    cpi_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    super_old: Mapped[str | None] = mapped_column(String(10), nullable=True)
    super_new: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Letter signoff
    signatory_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    signatory_title: Mapped[str | None] = mapped_column(String(160), nullable=True)
    signatory_company: Mapped[str | None] = mapped_column(String(120), nullable=True)
    hr_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=CycleStatus.DRAFT.value
    )

    # Uploaded wage model file
    wage_model_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    wage_model_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Audit
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ReviewCycle {self.id} {self.fy_label} status={self.status}>"
