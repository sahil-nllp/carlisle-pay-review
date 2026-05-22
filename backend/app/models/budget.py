"""Optional budget caps — per site per cycle."""
from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class Budget(Base, TimestampMixin):
    __tablename__ = "budgets"
    __table_args__ = (
        UniqueConstraint("cycle_id", "site", name="uq_budget_cycle_site"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(
        ForeignKey("review_cycles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    site: Mapped[str] = mapped_column(String(120), nullable=False)

    # Caps (nullable — sites without a budget are unconstrained)
    max_increase_cost: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    max_total_payroll: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)

    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
