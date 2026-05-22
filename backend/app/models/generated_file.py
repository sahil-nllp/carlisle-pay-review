"""Tracks files generated on site approval (letters, UKG upload, regional Excel)."""
from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class GeneratedFile(Base, TimestampMixin):
    __tablename__ = "generated_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(
        ForeignKey("review_cycles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    site: Mapped[str] = mapped_column(String(120), nullable=False, index=True)

    # "letters_zip" | "ukg_upload" | "regional_excel"
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    generated_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<GeneratedFile {self.file_type} site={self.site} cycle={self.cycle_id}>"
