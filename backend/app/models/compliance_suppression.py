"""Compliance suppression — records when a reviewer marks a compliance warning as noted."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ComplianceSuppression(Base):
    __tablename__ = "compliance_suppressions"
    __table_args__ = (
        # Only one active suppression per employee+check_label at a time
        UniqueConstraint(
            "employee_id", "check_label", "is_active",
            name="uq_suppression_employee_label_active",
        ),
        Index("ix_suppression_employee_id", "employee_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
    )
    check_label: Mapped[str] = mapped_column(String(80), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Active = suppressed; inactive = undone (row kept for audit)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Who suppressed it
    suppressed_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=False,
    )
    suppressed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # Who undid it (null if still active)
    undone_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    undone_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        state = "active" if self.is_active else "undone"
        return f"<ComplianceSuppression emp={self.employee_id} label={self.check_label!r} {state}>"
