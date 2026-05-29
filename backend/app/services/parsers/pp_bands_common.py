"""Shared types for the two Pay Progression parsers (admin + tech).

The PPBand model accepts rows from either file — they have slightly different
shapes but produce the same output structure.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ParsedPPBand:
    """One Pay Progression band — from Pay Progression Admin or Tech."""

    convention: str             # composite key, e.g. "HPSSL5 Technical AssistantEntry"
    award_key: str | None       # e.g. "HPSSL5" / "HPL2.1-2.4" / "HPSS SS L4"
    carlisle_label: str | None  # e.g. "Technical AssistantEntry" / "Pt Services First Year"
    stream: str                 # "admin" or "tech"

    section_header: str | None      # "Sonographer" / "Reception & Booking" / "Typing"
    award_level_group: str | None   # "2.1-2.4" / "5" / "9.3"

    band_min: float | None
    band_max: float | None

    experience_notes: str | None
    progression_notes: str | None

    display_order: int


@dataclass
class PPBandParseResult:
    sheet_name: str
    stream: str
    bands: list[ParsedPPBand] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
