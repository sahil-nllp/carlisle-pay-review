"""Schemas for Phase 3 & 4 — review workflow + approvals endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Annotated

from pydantic import BaseModel, ConfigDict, Field


# ─────────────────────────────────────────────────────────────────────────────
#  Site summary (for /cycles/{id}/sites)
# ─────────────────────────────────────────────────────────────────────────────
class SiteIssues(BaseModel):
    below_award: int = 0
    no_proposed_rate: int = 0
    unknown_level: int = 0


# ─────────────────────────────────────────────────────────────────────────────
#  Per-check result (mirrors compliance.CheckResult dataclass)
# ─────────────────────────────────────────────────────────────────────────────
class CheckResult(BaseModel):
    status: Literal["ok", "warn", "fail", "suppressed"]
    label: str
    detail: str
    recommendation: str = ""


class SuppressionInfo(BaseModel):
    """Who suppressed a check and when."""
    id: int
    check_label: str
    reason: str | None
    suppressed_by_name: str
    suppressed_at: datetime
    # Undo info (only present after undo)
    undone_by_name: str | None = None
    undone_at: datetime | None = None


class SiteSummary(BaseModel):
    site: str
    staff: int
    payroll_current: float   # hours * current_rate * 52
    payroll_proposed: float  # hours * proposed_rate * 52 (0 where no proposed rate)
    issues: SiteIssues
    approval_status: str     # mirrors Approval.status


# ─────────────────────────────────────────────────────────────────────────────
#  Employee with compliance flags (for /cycles/{id}/sites/{site}/employees)
# ─────────────────────────────────────────────────────────────────────────────
class EmployeeCompliance(BaseModel):
    checks: list[CheckResult] = Field(default_factory=list)
    overall: Literal["ok", "warn", "fail"] = "ok"
    award_minimum: float | None = None
    next_level: str | None = None      # suggested reclassification target
    band_min: float | None = None
    band_max: float | None = None
    suppressions: list[SuppressionInfo] = Field(default_factory=list)


class EmployeeWithCompliance(BaseModel):
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
    rate_type: str | None = None
    hours_per_pay_period: float | None = None
    hours_per_week: float | None
    current_award: str | None
    current_rate: float | None
    proposed_award: str | None    # accepted next-level suggestion
    pp_level: str | None
    change_type: str | None
    change_input: float | None
    proposed_rate: float | None
    letter_type: str | None
    notes: str | None
    is_departed: bool

    compliance: EmployeeCompliance = Field(default_factory=EmployeeCompliance)


# ─────────────────────────────────────────────────────────────────────────────
#  Employee PATCH
# ─────────────────────────────────────────────────────────────────────────────
class EmployeePatchRequest(BaseModel):
    # Review workflow — proposed_rate is calculated server-side from these two
    change_type: str | None = None
    change_input: float | None = None
    # Accepted next-level suggestion (empty string = clear)
    proposed_award: str | None = None
    # Other editable fields
    pp_level: str | None = None
    letter_type: str | None = None
    notes: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
#  Bulk suggest
# ─────────────────────────────────────────────────────────────────────────────
class SuppressCheckRequest(BaseModel):
    check_label: str
    reason: str | None = None


class BulkSuggestRequest(BaseModel):
    site: str | None = None  # limit to one site; None = entire cycle


class BulkSuggestResponse(BaseModel):
    updated: int
    skipped: int  # employees already with a proposed rate (not overwritten)


class BulkAssignLettersResponse(BaseModel):
    updated: int   # employees whose letter_type was set / changed
    skipped: int   # employees with no proposed rate (can't infer)


# ─────────────────────────────────────────────────────────────────────────────
#  Site submission / approval
# ─────────────────────────────────────────────────────────────────────────────
class SubmitSiteRequest(BaseModel):
    site: str


class SubmitSiteResponse(BaseModel):
    site: str
    status: Literal["pending"]
    issues_count: int  # hard compliance errors remaining


class ApprovalDecisionRequest(BaseModel):
    decision: Literal["approve", "request_changes"]
    comment: str | None = None


class ApprovalDecisionResponse(BaseModel):
    site: str
    status: Literal["approved", "changes_requested"]


# ─────────────────────────────────────────────────────────────────────────────
#  Approval list (Phase 4 — /cycles/{id}/approvals)
# ─────────────────────────────────────────────────────────────────────────────
class ApprovalDetail(BaseModel):
    """One row in the approvals list — site summary + approval metadata."""
    id: int
    site: str
    status: str                        # ApprovalStatus value

    # Site aggregates (mirrors SiteSummary)
    staff: int
    payroll_current: float
    payroll_proposed: float
    hard_issues: int                   # fail-level compliance errors
    warn_count: int = 0               # warn-level issues not yet suppressed

    # Submission info
    submitted_by: str | None = None    # display name
    submitted_at: datetime | None = None
    submission_notes: str | None = None

    # Decision info
    decided_by: str | None = None
    decided_at: datetime | None = None
    decision_notes: str | None = None
