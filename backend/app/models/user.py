"""User account model."""
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class UserRole(StrEnum):
    HR_ADMIN = "hr_admin"
    REGIONAL_MANAGER = "regional_manager"
    SENIOR_MANAGEMENT = "senior_management"
    PAYROLL = "payroll"


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Identity
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Authorisation
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    # Site assignment — only meaningful for role=regional_manager
    site: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.id} {self.email} role={self.role}>"
