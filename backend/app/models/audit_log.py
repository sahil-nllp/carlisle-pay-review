"""Audit log — every state-changing action recorded here."""
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column


from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
        nullable=False,
    )

    # Who
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )

    # What
    action: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    # e.g. "login", "upload_wage_model", "edit_employee", "submit_site",
    #      "approve_site", "generate_letters", "generate_payroll"

    # Which entity (optional)
    entity_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Context — before/after values, IP, anything else useful
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AuditLog {self.id} {self.action} user={self.user_id}>"
