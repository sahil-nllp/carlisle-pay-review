"""Employee row — one per person per review cycle."""
from datetime import date
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class ChangeType(StrEnum):
    PERCENT_INCREASE = "percent_increase"
    CPI_INCREASE = "cpi_increase"
    PER_ADMIN_PP = "per_admin_pp"
    FIXED_RATE = "fixed_rate"
    NO_CHANGE = "no_change"


class LetterType(StrEnum):
    A = "A"  # Rate increase only
    B = "B"  # Rate + award level change
    C = "C"  # Award level change only
    NONE = "none"


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"
    __table_args__ = (
        UniqueConstraint("cycle_id", "emp_num", name="uq_employee_cycle_empnum"),
        Index("ix_employee_cycle_site", "cycle_id", "site"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(
        ForeignKey("review_cycles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    # Identity (from Employee_Details.xlsx)
    emp_num: Mapped[str] = mapped_column(String(50), nullable=False)
    first_name: Mapped[str] = mapped_column(String(120), nullable=False)
    last_name: Mapped[str] = mapped_column(String(120), nullable=False)
    preferred_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Employment dates (new — from Employee_Details)
    service_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    hire_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Organisation (from Employee_Details)
    site: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # "Job Classification" from Employee_Details — generic role label
    # e.g. "Sonographer", "Chief Radiographer", "Radiographer/MLO"
    # Used as context for picking the pp_level (Convention) during review.
    job_classification: Mapped[str | None] = mapped_column(String(160), nullable=True)

    # Rate & hours
    rate_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "Hourly" / "Salary"
    hours_per_pay_period: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    hours_per_week: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)

    # Current state (entering this review cycle)
    current_award: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Award Agreement from Employee_Details (e.g. "HPSS HP L3 PP5")
    current_rate: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    # "Amount" from Employee_Details

    # Proposed state (this review)
    proposed_award: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # accepted next level — set by reviewer when accepting a level-change suggestion
    pp_level: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # Convention key linking to PPBand.convention — assigned during review
    change_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    change_input: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    proposed_rate: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    letter_type: Mapped[str | None] = mapped_column(String(8), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status flags
    is_departed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Employee {self.emp_num} {self.first_name} {self.last_name} @ {self.site}>"
