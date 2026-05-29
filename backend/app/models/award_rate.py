"""MA000027 award rates — uploaded per cycle from Award Summary.xlsx.

Replaces the hard-coded AWARD_RATES / AWARD_ORDER dicts that previously lived
in app/services/compliance.py.
"""
from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class AwardRate(Base, TimestampMixin):
    __tablename__ = "award_rates"
    __table_args__ = (
        UniqueConstraint("cycle_id", "award_level", name="uq_award_rate_cycle_level"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(
        ForeignKey("review_cycles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    # Identity — "HPSS HP L1 PP1" / "HPSS SS L4" etc.
    award_level: Mapped[str] = mapped_column(String(80), nullable=False)

    # Weekly figures (from Award Summary cols B–D for FY24/25, but we only store FY25/26)
    weekly_rate: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    laundry: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    combined_weekly: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)

    # Hourly figures (FY25/26 only, from cols G–I)
    hourly_rate: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    laundry_hourly: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    combined_hourly: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)

    # Preserves Excel ordering — used by ceiling / progression checks
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Section header from Excel ("Health Professionals: Level 1" etc) — purely informational
    section_header: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # True for "Off Award - Contract" / "Nurses Award" / similar rows that
    # appear in the Excel but don't have a numeric rate (#N/A in the cells).
    is_off_award: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AwardRate {self.award_level} ${self.hourly_rate}/hr (cycle {self.cycle_id})>"
