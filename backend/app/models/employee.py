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

    # Identity (from UKG)
    emp_num: Mapped[str] = mapped_column(String(50), nullable=False)
    first_name: Mapped[str] = mapped_column(String(120), nullable=False)
    last_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    # DOB used for junior rate (under 21) checks at FY end date
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Organisation
    site: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    hours_per_week: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)

    # Current state (FY25)
    fy25_award: Mapped[str | None] = mapped_column(String(60), nullable=True)
    current_rate: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)

    # Proposed state (FY26)
    fy26_award: Mapped[str | None] = mapped_column(String(60), nullable=True)
    proposed_award: Mapped[str | None] = mapped_column(String(60), nullable=True)  # accepted next level
    pp_level: Mapped[str | None] = mapped_column(String(120), nullable=True)
    change_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    change_input: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    proposed_rate: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    letter_type: Mapped[str | None] = mapped_column(String(8), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Historical compliance snapshot (FY25 → FY26, read from Excel, display-only)
    # These mirror the 5 compliance columns in the source wage model.
    hist_award_level_changed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    hist_rate_changed:        Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    hist_above_award_rate:    Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    hist_above_pp_rate:       Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    hist_above_pp_max:        Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Status flags
    is_departed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Employee {self.emp_num} {self.first_name} {self.last_name} @ {self.site}>"
