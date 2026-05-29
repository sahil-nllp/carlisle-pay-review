"""Review cycle — one per financial year."""
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class CycleStatus(StrEnum):
    DRAFT = "draft"           # Files uploaded, not yet rolled out
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

    # ── Uploaded source files (4 separate files per cycle) ────────────────────
    # Employee_Details.xlsx — drives the employees table
    employee_file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    employee_file_uploaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Award Summary.xlsx — drives award_rates + junior_rates tables
    award_summary_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    award_summary_uploaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Pay Progression Admin.xlsx — drives pp_bands (stream=admin)
    pp_admin_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pp_admin_uploaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Pay Progression Tech.xlsx — drives pp_bands (stream=tech)
    pp_tech_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pp_tech_uploaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # True once all 3 reference files (award_summary + pp_admin + pp_tech) are loaded
    # Compliance engine refuses to run if this is false.
    reference_data_ready: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # Audit
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ReviewCycle {self.id} {self.fy_label} status={self.status}>"
