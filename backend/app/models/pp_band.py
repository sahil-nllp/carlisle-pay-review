"""Carlisle internal Pay Progression bands — uploaded per cycle from
Pay Progression Tech.xlsx and Pay Progression Admin.xlsx.

Replaces the hard-coded PP_BANDS dict that previously lived in
app/services/compliance.py.
"""
from enum import StrEnum

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class PPStream(StrEnum):
    ADMIN = "admin"   # Pay Progression Admin.xlsx — support services
    TECH = "tech"     # Pay Progression Tech.xlsx — technical roles


class PPBand(Base, TimestampMixin):
    __tablename__ = "pp_bands"
    __table_args__ = (
        UniqueConstraint("cycle_id", "convention", name="uq_pp_band_cycle_convention"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(
        ForeignKey("review_cycles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    # The composite key — column "Convention" in the Excel.
    # e.g. "HPSSL5 Technical AssistantEntry", "HPSS SS L4 Pt Services First Year"
    # This is what gets stored in Employee.pp_level to link an employee to a band.
    convention: Mapped[str] = mapped_column(String(160), nullable=False)

    # The two columns that make up the Convention string:
    award_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # e.g. "HPSSL5" / "HPL2.1-2.4" / "HPSS SS L4"
    carlisle_label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # e.g. "Technical AssistantEntry" / "Pt Services First Year"

    # Source file — "tech" or "admin"
    stream: Mapped[str] = mapped_column(String(10), nullable=False)

    # Section header from Excel ("Sonographer", "Reception & Booking", "Typing", etc)
    section_header: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Award level group as displayed in Excel ("2.1-2.4", "1.3-1.6", "5", etc)
    award_level_group: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # FY25/26 band (the only data we read from the Excel)
    band_min: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    band_max: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)

    # Free-form notes from the Excel — useful for the review UI
    experience_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    progression_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Preserves Excel ordering — used for dropdown sorting in review UI
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<PPBand {self.convention} ${self.band_min}-${self.band_max} (cycle {self.cycle_id})>"
