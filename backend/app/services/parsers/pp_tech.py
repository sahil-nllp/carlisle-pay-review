"""Parser for Pay Progression Tech.xlsx — Carlisle internal bands for technical roles.

Source columns (0-based — we ONLY read the FY25/26 columns):
  A  (0)  Award                    → award_key       (e.g. "HPSSL5", "HPL2.1-2.4")
  B  (1)  Carlisle                 → carlisle_label  (e.g. "RadiographerQualified")
  C  (2)  Convention               → convention (composite key)
  D  (3)  (blank separator)
  E  (4)  minimum rate / role name → either section header role name OR the role's label
  F  (5)  Award Level              → award_level_group ("5", "2.1-2.4", ...)
  G  (6)  Equivalent experience    → experience_notes
  H  (7)  Progression/Competency   → progression_notes
  I  (8)  (blank separator)
  J  (9)  FY 24/25 Band min        ← IGNORED
  K  (10) FY 24/25 Band max        ← IGNORED
  L  (11) (blank separator)
  M  (12) FY 25/26 Band min        → band_min
  N  (13) FY 25/26 Band max        → band_max

Section headers are rows where col A is empty but col D ("minimum rate" col)
contains the role group name ("Radiographer", "Sonographer", "MRI Radiographer",
"Management", etc).

The file has an appendix from row ~35+ with exam types / training levels —
we stop reading once we leave the band table.
"""
from __future__ import annotations

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
# col 3 blank
COL_SECTION_OR_ROLE = 4   # "minimum rate" header — holds section names like "Sonographer"
COL_AWARD_LEVEL_GROUP = 5
COL_EXPERIENCE = 6
COL_PROGRESSION = 7
# cols 9-11 FY 24/25 — IGNORED
COL_BAND_MIN_25 = 12
COL_BAND_MAX_25 = 13


def parse_pp_tech(source: bytes | Path | str) -> PPBandParseResult:
    wb = load_workbook(source)
    sheet = pick_first_sheet(wb)
    result = PPBandParseResult(sheet_name=sheet.title, stream="tech")

    current_section: str | None = None
    display_order = 0
    blank_rows = 0

    for row_num, row in enumerate(
        sheet.iter_rows(min_row=5, values_only=True), start=5
    ):
        if not row or all(c is None for c in row[:14]):
            blank_rows += 1
            # Three+ consecutive blanks → we've left the band table
            if blank_rows >= 3:
                break
            continue
        blank_rows = 0

        award = clean_str(row[COL_AWARD] if COL_AWARD < len(row) else None)
        carlisle = clean_str(row[COL_CARLISLE] if COL_CARLISLE < len(row) else None)
        convention = clean_str(row[COL_CONVENTION] if COL_CONVENTION < len(row) else None)

        # Data rows have a Convention; anything else is a section header
        if not convention:
            section_text = clean_str(
                row[COL_SECTION_OR_ROLE] if COL_SECTION_OR_ROLE < len(row) else None
            )
            if section_text:
                # Filter out appendix headers — once we see "Examination" or
                # "Guide for", we're in the appendix and should stop.
                low = section_text.lower()
                if "examination" in low or "guide for" in low:
                    break
                current_section = section_text
            continue

        band_min = _safe_float(row, COL_BAND_MIN_25)
        band_max = _safe_float(row, COL_BAND_MAX_25)

        if band_min is None and band_max is None:
            result.warnings.append(
                f"Row {row_num} ({convention}): no FY25/26 band min/max"
            )

        display_order += 1
        result.bands.append(
            ParsedPPBand(
                convention=convention,
                award_key=award,
                carlisle_label=carlisle,
                stream="tech",
                section_header=current_section,
                award_level_group=_clean_award_group(
                    row[COL_AWARD_LEVEL_GROUP]
                    if COL_AWARD_LEVEL_GROUP < len(row)
                    else None
                ),
                band_min=band_min,
                band_max=band_max,
                experience_notes=clean_str(
                    row[COL_EXPERIENCE] if COL_EXPERIENCE < len(row) else None
                ),
                progression_notes=clean_str(
                    row[COL_PROGRESSION] if COL_PROGRESSION < len(row) else None
                ),
                display_order=display_order,
            )
        )

    if not result.bands:
        result.warnings.append("No PP bands found in Pay Progression Tech file.")

    return result


def _safe_float(row: tuple[Any, ...], idx: int) -> float | None:
    if idx >= len(row):
        return None
    return clean_float(row[idx])


def _clean_award_group(v: Any) -> str | None:
    """Normalise the award level group cell — accepts strings or floats."""
    if v is None or v == "":
        return None
    if isinstance(v, float):
        # Drop trailing zero: 5.0 → "5"
        if v.is_integer():
            return str(int(v))
        return str(v)
    return str(v).strip() or None
