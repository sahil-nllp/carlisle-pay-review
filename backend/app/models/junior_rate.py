"""Junior rate multipliers — MA000027 Schedule B.

Uploaded per cycle from the Award Summary.xlsx file (columns O–T, ages 15–20).
Replaces the hard-coded JUNIOR_RATES dict in app/services/compliance.py.
"""
from sqlalchemy import ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class JuniorRate(Base, TimestampMixin):
    __tablename__ = "junior_rates"
    __table_args__ = (
        UniqueConstraint("cycle_id", "age", name="uq_junior_rate_cycle_age"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(
        ForeignKey("review_cycles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    age: Mapped[int] = mapped_column(Integer, nullable=False)
    # multiplier as a fraction (0.50 = 50% of adult rate)
    multiplier: Mapped[float] = mapped_column(Numeric(5, 4), nullable=False)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<JuniorRate age={self.age} {self.multiplier} (cycle {self.cycle_id})>"
