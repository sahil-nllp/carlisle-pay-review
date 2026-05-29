"""Parser for Pay Progression Admin.xlsx — Carlisle internal bands for support services.

Source columns (0-based — we ONLY read the FY25/26 columns):
  A  (0)  Award                     → award_key       (e.g. "HPSS SS L4")
  B  (1)  Carlisle                  → carlisle_label  (e.g. "Pt Services First Year")
  C  (2)  Convention                → convention (composite key)
  D  (3)  minimum rate / section    → section header text OR step label
  E  (4)  Award Level               → award_level_group (numeric or "9.1" etc)
  F  (5)  Equivalent experience     → experience_notes
  G  (6)  Progression/Competency    → progression_notes
  H  (7)  (blank separator)
  I  (8)  FY 24/25 Hourly Rate      ← IGNORED
  J  (9)  FY 24/25 award diff       ← IGNORED
  K  (10) FY 24/25 F/T pa           ← IGNORED
  L  (11) FY 24/25 % change         ← IGNORED
  M  (12) (blank separator)
  N  (13) FY 25/26 Hourly Rate      → step_rate
  O  (14) FY 25/26 award diff       (informational, not stored)
  P  (15) FY 25/26 F/T pa           (informational, not stored)
  Q  (16) FY 25/26 % change         (informational, not stored)

Unlike the Tech file, this file has a SINGLE rate per step (not min/max).
We synthesize the band as:
  band_min = this row's step_rate
  band_max = next row's step_rate IN THE SAME SECTION (or None if last step)

That matches the original PP_BANDS dict logic: someone in "First Year" is
allowed to sit between the First Year rate and the Second Year rate;
hitting Second Year rate means it's time to be promoted.

Section headers appear as rows where cols A/B/C are empty but col D contains
the section text ("Reception & Booking", "Typing", "Supervisor (1-5 in team)",
"Admin Supervisor", etc).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.services.parsers._helpers import (
    clean_float,
    clean_str,
    load_workbook,
    pick_first_sheet,
)
from app.services.parsers.pp_bands_common import (
    ParsedPPBand,
    PPBandParseResult,
)


# Column indexes (0-based)
COL_AWARD = 0
COL_CARLISLE = 1
COL_CONVENTION = 2
COL_SECTION_OR_STEP = 3
COL_AWARD_LEVEL_GROUP = 4
COL_EXPERIENCE = 5
COL_PROGRESSION = 6
# cols 8-11 FY 24/25 — IGNORED
COL_HOURLY_25 = 13


@dataclass
class _StagedRow:
    """Intermediate — admin rows need a second pass to compute band_max."""

    convention: str
    award_key: str | None
    carlisle_label: str | None
    section_header: str | None
    award_level_group: str | None
    experience_notes: str | None
    progression_notes: str | None
    step_rate: float | None
    display_order: int


def parse_pp_admin(source: bytes | Path | str) -> PPBandParseResult:
    wb = load_workbook(source)
    sheet = pick_first_sheet(wb)
    result = PPBandParseResult(sheet_name=sheet.title, stream="admin")

    current_section: str | None = None
    staged: list[_StagedRow] = []
    display_order = 0

    for row_num, row in enumerate(
        sheet.iter_rows(min_row=5, values_only=True), start=5
    ):
        if not row or all(c is None for c in row[:17]):
            continue

        # Stop if we've reached the appended Tech-section / appendix
        if _row_marks_section_end(row):
            break

        award = clean_str(row[COL_AWARD] if COL_AWARD < len(row) else None)
        carlisle = clean_str(row[COL_CARLISLE] if COL_CARLISLE < len(row) else None)
        convention = clean_str(row[COL_CONVENTION] if COL_CONVENTION < len(row) else None)

        # Header row of an appended section — col 0 says "Award"
        if award and award.lower() == "award" and convention and convention.lower() == "convention":
            break

        # Data rows have a Convention; anything else is a section header
        # (possibly with award info, e.g. "HPSS SS L7 / 2IC (6+ in team)")
        if not convention:
            section_text = clean_str(
                row[COL_SECTION_OR_STEP] if COL_SECTION_OR_STEP < len(row) else None
            )
            if section_text:
                low = section_text.lower()
                if "examination" in low or "guide for sono" in low:
                    break
                current_section = section_text
            continue

        rate = _safe_float(row, COL_HOURLY_25)

        display_order += 1
        staged.append(
            _StagedRow(
                convention=convention,
                award_key=award,
                carlisle_label=carlisle,
                section_header=current_section,
                award_level_group=_clean_award_group(
                    row[COL_AWARD_LEVEL_GROUP]
                    if COL_AWARD_LEVEL_GROUP < len(row)
                    else None
                ),
                experience_notes=clean_str(
                    row[COL_EXPERIENCE] if COL_EXPERIENCE < len(row) else None
                ),
                progression_notes=clean_str(
                    row[COL_PROGRESSION] if COL_PROGRESSION < len(row) else None
                ),
                step_rate=rate,
                display_order=display_order,
            )
        )

    # ── Second pass — compute band_max from the next step in same section ─────
    for i, st in enumerate(staged):
        band_max: float | None = None
        # Find next step in same section
        for j in range(i + 1, len(staged)):
            nxt = staged[j]
            if nxt.section_header != st.section_header:
                break
            if nxt.step_rate is not None:
                band_max = nxt.step_rate
                break

        result.bands.append(
            ParsedPPBand(
                convention=st.convention,
                award_key=st.award_key,
                carlisle_label=st.carlisle_label,
                stream="admin",
                section_header=st.section_header,
                award_level_group=st.award_level_group,
                band_min=st.step_rate,
                band_max=band_max,
                experience_notes=st.experience_notes,
                progression_notes=st.progression_notes,
                display_order=st.display_order,
            )
        )

    if not result.bands:
        result.warnings.append("No PP bands found in Pay Progression Admin file.")

    return result


def _safe_float(row: tuple[Any, ...], idx: int) -> float | None:
    if idx >= len(row):
        return None
    return clean_float(row[idx])


# Markers that indicate the row is the start of an appended Tech section or appendix
_STOP_MARKERS = (
    "rates for technical team",
    "examination general",
    "guide for sono",
)


def _row_marks_section_end(row: tuple[Any, ...]) -> bool:
    for cell in row[:8]:
        if isinstance(cell, str):
            low = cell.strip().lower()
            if any(m in low for m in _STOP_MARKERS):
                return True
    return False


def _clean_award_group(v: Any) -> str | None:
    if v is None or v == "":
        return None
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        return str(v)
    return str(v).strip() or None
