"""Parser for Award Summary.xlsx — MA000027 rate table.

Produces two outputs:
  1. ParsedAwardRate — one per award level (HPSS HP L1 PP1, HPSS SS L4, ...)
  2. ParsedJuniorRate — age → multiplier (ages 15-20 from MA000027 Schedule B)

Source columns (0-based — we ONLY read the FY25/26 columns):
  A  (0)  Award Agreement                  → award_level OR section header
  B  (1)  Minimum Weekly Rate (FY24/25)    ← IGNORED
  C  (2)  Laundry weekly                   → laundry (constant 1.6 across rows)
  D  (3)  Combined Weekly (FY24/25)        ← IGNORED
  E  (4)  Minimum Hourly Rate (FY24/25)    ← IGNORED
  F  (5)  (blank separator)
  G  (6)  Minimum Hourly Rate (FY25/26)    → hourly_rate
  H  (7)  Laundry per hour (FY25/26)       → laundry_hourly
  I  (8)  Combined Hourly Rate (FY25/26)   → combined_hourly
  ...
  O–T (14-19)  Junior multipliers          → junior_rates (header row 2, ages row 1)

Section header rows have text in col A but col B is empty (None, not 0).
Off-award rows have text in col A but col G is "#N/A" or None.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.services.parsers._helpers import (
    clean_float,
    clean_str,
    is_na,
    load_workbook,
    pick_first_sheet,
)


# Column indexes (0-based)
COL_AWARD_LEVEL = 0
COL_WEEKLY_24 = 1
COL_LAUNDRY_WEEKLY = 2
COL_COMBINED_WEEKLY_24 = 3
COL_HOURLY_24 = 4
# col 5 blank
COL_HOURLY_25 = 6
COL_LAUNDRY_HOURLY_25 = 7
COL_COMBINED_HOURLY_25 = 8
# Junior multipliers: ages 15-20 in cols 14-19
JUNIOR_COL_START = 14
JUNIOR_AGES = [15, 16, 17, 18, 19, 20]

# Header row that holds the multiplier fractions (0.5, 0.5, 0.6, 0.7, 0.8, 0.9)
JUNIOR_MULTIPLIER_ROW = 2

# Award-level prefixes we recognise as data rows (everything else is treated
# as a section header or skipped).
AWARD_PREFIXES = ("HPSS", "HPSSA", "HP", "SS", "Off Award", "Off-Award", "Nurses Award")


@dataclass
class ParsedAwardRate:
    award_level: str            # "HPSS HP L1 PP1"
    section_header: str | None  # "Health Professionals: Level 1"
    weekly_rate: float | None
    laundry: float | None
    combined_weekly: float | None
    hourly_rate: float | None
    laundry_hourly: float | None
    combined_hourly: float | None
    is_off_award: bool
    display_order: int


@dataclass
class ParsedJuniorRate:
    age: int
    multiplier: float


@dataclass
class AwardSummaryParseResult:
    sheet_name: str
    rates: list[ParsedAwardRate] = field(default_factory=list)
    junior_rates: list[ParsedJuniorRate] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
#  Public API
# ─────────────────────────────────────────────────────────────────────────────
def parse_award_summary(source: bytes | Path | str) -> AwardSummaryParseResult:
    wb = load_workbook(source)
    sheet = pick_first_sheet(wb)

    result = AwardSummaryParseResult(sheet_name=sheet.title)

    # ── Pull junior multipliers from row 2 ────────────────────────────────────
    if sheet.max_row and sheet.max_row >= JUNIOR_MULTIPLIER_ROW:
        mrow = sheet[JUNIOR_MULTIPLIER_ROW]
        for offset, age in enumerate(JUNIOR_AGES):
            col_idx = JUNIOR_COL_START + offset
            if col_idx >= len(mrow):
                break
            mult = clean_float(mrow[col_idx].value)
            if mult is not None and 0 < mult <= 1:
                result.junior_rates.append(ParsedJuniorRate(age=age, multiplier=mult))

    if not result.junior_rates:
        result.warnings.append(
            "Junior multipliers not found in row 2 cols O-T — junior rate "
            "compliance check will be disabled for this cycle."
        )

    # ── Iterate award rate rows ───────────────────────────────────────────────
    current_section: str | None = None
    display_order = 0

    # Skip the first 3 header rows
    for row in sheet.iter_rows(min_row=4, values_only=True):
        if not row or all(c is None for c in row[:9]):
            continue

        col_a = row[COL_AWARD_LEVEL] if COL_AWARD_LEVEL < len(row) else None
        label = clean_str(col_a)
        if not label:
            continue

        # Section header: col A has text but col B (weekly rate) is None
        col_b = row[COL_WEEKLY_24] if COL_WEEKLY_24 < len(row) else None
        if col_b is None and not label.startswith(AWARD_PREFIXES):
            current_section = label
            continue

        # Award-level data row
        weekly = _safe_float(row, COL_WEEKLY_24)
        laundry = _safe_float(row, COL_LAUNDRY_WEEKLY)
        combined_w = _safe_float(row, COL_COMBINED_WEEKLY_24)
        hourly = _safe_float(row, COL_HOURLY_25)
        laundry_h = _safe_float(row, COL_LAUNDRY_HOURLY_25)
        combined_h = _safe_float(row, COL_COMBINED_HOURLY_25)

        # Off-award detection: hourly_rate is missing or #N/A
        is_off_award = hourly is None or _cell_is_na(row, COL_HOURLY_25)

        display_order += 1
        result.rates.append(
            ParsedAwardRate(
                award_level=label,
                section_header=current_section,
                weekly_rate=weekly,
                laundry=laundry,
                combined_weekly=combined_w,
                hourly_rate=hourly,
                laundry_hourly=laundry_h,
                combined_hourly=combined_h,
                is_off_award=is_off_award,
                display_order=display_order,
            )
        )

    if not result.rates:
        result.warnings.append("No award rate rows found.")

    return result


# ─────────────────────────────────────────────────────────────────────────────
#  Internals
# ─────────────────────────────────────────────────────────────────────────────
def _safe_float(row: tuple[Any, ...], idx: int) -> float | None:
    if idx >= len(row):
        return None
    return clean_float(row[idx])


def _cell_is_na(row: tuple[Any, ...], idx: int) -> bool:
    if idx >= len(row):
        return True
    return is_na(row[idx])
