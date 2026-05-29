"""Schemas for the four-file upload flow (Phase 4 — 4-file uploader)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.cycle import CycleMetadata, CycleResponse, EmployeeDiffRow


# ─────────────────────────────────────────────────────────────────────────────
#  Per-file summaries (what we found in each .xlsx)
# ─────────────────────────────────────────────────────────────────────────────
class EmployeeFileSummary(BaseModel):
    filename: str
    sheet_name: str
    columns_detected: list[str]
    employees_parsed: int
    warnings: list[str] = Field(default_factory=list)


class AwardSummaryFileSummary(BaseModel):
    filename: str
    sheet_name: str
    award_rates: int            # rows with hourly_rate
    off_award_rows: int         # rows marked as off-award
    junior_rates: int           # multipliers parsed (expected 6 for ages 15-20)
    warnings: list[str] = Field(default_factory=list)


class PPFileSummary(BaseModel):
    filename: str
    sheet_name: str
    stream: Literal["admin", "tech"]
    bands: int
    sections: list[str]
    warnings: list[str] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
#  Combined staged response (Step 1)
# ─────────────────────────────────────────────────────────────────────────────
class StagedUploadResponse(BaseModel):
    staging_id: str            # opaque session id — passed to /apply

    employee_file: EmployeeFileSummary
    award_summary: AwardSummaryFileSummary
    pp_admin: PPFileSummary
    pp_tech: PPFileSummary

    # Employee diff vs current cycle (if any)
    current_cycle: CycleResponse | None = None
    employee_diff_summary: dict[str, int] = Field(default_factory=dict)
    # {"new": N, "removed": N, "changed": N, "unchanged": N, "total": N}
    employee_diff_preview: list[EmployeeDiffRow] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
#  Apply request (Step 2)
# ─────────────────────────────────────────────────────────────────────────────
class ApplyUploadRequest(BaseModel):
    staging_id: str
    metadata: CycleMetadata
    # How to handle relative to the current active cycle:
    #   - "fresh":   no current cycle, create new
    #   - "archive": archive current, create new
    #   - "merge":   update current cycle's data in place (replace reference data,
    #                upsert employees, mark missing as departed)
    mode: Literal["fresh", "archive", "merge"]


class ApplyUploadResponse(BaseModel):
    cycle: CycleResponse
    employees_inserted: int
    employees_updated: int
    employees_removed: int
    award_rates_loaded: int
    pp_bands_loaded: int       # admin + tech combined
    junior_rates_loaded: int


# ─────────────────────────────────────────────────────────────────────────────
#  Cancel
# ─────────────────────────────────────────────────────────────────────────────
class CancelStagingRequest(BaseModel):
    staging_id: str
