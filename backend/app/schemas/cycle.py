"""Cycle / employee / upload-diff schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ─────────────────────────────────────────────────────────────────────────────
#  Cycle
# ─────────────────────────────────────────────────────────────────────────────
class CycleMetadata(BaseModel):
    """Cycle-level config the user can edit on upload."""

    fy_label: str = Field(min_length=4, max_length=20, examples=["FY2026-27"])
    effective_date: date
    letter_date: date
    cpi_rate: float = Field(ge=0, le=100, default=2.4)


class CycleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    fy_label: str
    effective_date: date
    letter_date: date
    consultation_deadline: date | None
    cpi_rate: float
    super_old: float | None
    super_new: float | None
    signatory_name: str | None
    signatory_title: str | None
    signatory_company: str | None
    hr_email: str | None
    status: str
    reference_data_ready: bool = False
    created_at: datetime


class CycleSettingsRequest(BaseModel):
    """Editable letter/signatory fields on an existing cycle."""
    letter_date: date | None = None
    effective_date: date | None = None
    consultation_deadline: date | None = None
    cpi_rate: float | None = Field(default=None, ge=0, le=100)
    super_old: float | None = Field(default=None, ge=0, le=100)
    super_new: float | None = Field(default=None, ge=0, le=100)
    signatory_name: str | None = Field(default=None, max_length=200)
    signatory_title: str | None = Field(default=None, max_length=200)
    signatory_company: str | None = Field(default=None, max_length=200)
    hr_email: str | None = Field(default=None, max_length=255)


# ─────────────────────────────────────────────────────────────────────────────
#  Employee
# ─────────────────────────────────────────────────────────────────────────────
class EmployeeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cycle_id: int
    emp_num: str
    first_name: str
    last_name: str
    preferred_name: str | None = None
    email: str | None
    age: int | None
    site: str
    department: str | None
    category: str | None
    job_classification: str | None = None
    hours_per_week: float | None
    current_award: str | None
    current_rate: float | None
    pp_level: str | None
    change_type: str | None
    proposed_rate: float | None
    letter_type: str | None
    notes: str | None
    is_departed: bool


# ─────────────────────────────────────────────────────────────────────────────
#  Upload + diff
# ─────────────────────────────────────────────────────────────────────────────
class EmployeeDiffRow(BaseModel):
    """One row in the diff preview."""

    emp_num: str
    name: str
    site: str
    kind: Literal["new", "removed", "changed", "unchanged"]
    changes: dict[str, dict[str, str | float | None]] = Field(default_factory=dict)
    # changes["current_rate"] = {"old": 50, "new": 55}


class UploadStagedResponse(BaseModel):
    """Returned after an Excel is uploaded but not yet committed.

    Front-end uses this to render the comparison screen.
    """

    staging_id: str  # opaque token identifying the staged file
    filename: str

    # Detection info
    sheet_name: str
    columns_detected: list[str]
    row_count: int
    warnings: list[str] = Field(default_factory=list)

    # Diff summary (vs current active cycle, if any)
    current_cycle: CycleResponse | None = None
    summary: dict[str, int]
    # {"new": N, "removed": N, "changed": N, "unchanged": N, "total": N}

    # Up to N preview rows for the UI (capped to keep payload small)
    preview: list[EmployeeDiffRow] = Field(default_factory=list)


class UploadApplyRequest(BaseModel):
    staging_id: str
    filename: str
    metadata: CycleMetadata
    # How to handle the upload relative to the current active cycle:
    #   - "fresh":  no current cycle, create a new one
    #   - "archive": archive current cycle, create a new one
    #   - "merge":  update current cycle's employees in place
    mode: Literal["fresh", "archive", "merge"]


class UploadApplyResponse(BaseModel):
    cycle: CycleResponse
    employees_inserted: int
    employees_updated: int
    employees_removed: int
