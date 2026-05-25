"""Review-workflow endpoints (Phase 3).

Routes:
  GET  /cycles/{cycle_id}/sites                  — site summaries + approval statuses
  GET  /cycles/{cycle_id}/sites/{site}/employees — employees with compliance flags
  PATCH /employees/{emp_id}                      — update proposed rate / letter type etc.
  POST  /cycles/{cycle_id}/bulk-suggest          — auto-fill proposed rates (CPI / award floor)
  POST  /cycles/{cycle_id}/sites/{site}/submit   — regional manager submits site for approval
  POST  /cycles/{cycle_id}/sites/{site}/decide   — senior management approves / requests changes
"""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_roles
from app.database import get_db
from app.models import (
    Approval,
    ApprovalStatus,
    AuditLog,
    ComplianceSuppression,
    Employee,
    GeneratedFile,
    ReviewCycle,
    User,
    UserRole,
)
from app.services import documents as doc_service
from app.services import storage
from app.schemas.review import (
    ApprovalDecisionRequest,
    ApprovalDecisionResponse,
    ApprovalDetail,
    BulkAssignLettersResponse,
    BulkSuggestRequest,
    BulkSuggestResponse,
    CheckResult,
    EmployeeCompliance,
    EmployeePatchRequest,
    EmployeeWithCompliance,
    SiteIssues,
    SiteSummary,
    SubmitSiteRequest,
    SubmitSiteResponse,
    SuppressCheckRequest,
    SuppressionInfo,
)
from app.services import compliance as cs
from app.services import cycles as cycle_service

router = APIRouter(tags=["review"])


# ─────────────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────────────
async def _get_cycle_or_404(db: AsyncSession, cycle_id: int) -> ReviewCycle:
    cycle = await db.get(ReviewCycle, cycle_id)
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    return cycle


async def _get_approval(
    db: AsyncSession, cycle_id: int, site: str
) -> Approval | None:
    stmt = select(Approval).where(
        Approval.cycle_id == cycle_id, Approval.site == site
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _get_or_create_approval(
    db: AsyncSession, cycle_id: int, site: str
) -> Approval:
    appr = await _get_approval(db, cycle_id, site)
    if appr is None:
        appr = Approval(
            cycle_id=cycle_id,
            site=site,
            status=ApprovalStatus.NOT_SUBMITTED.value,
        )
        db.add(appr)
        await db.flush()
    return appr


async def _load_suppressions_for_employees(
    db: AsyncSession, emp_ids: list[int]
) -> tuple[dict[int, set[str]], dict[int, list[SuppressionInfo]]]:
    """Bulk-load active suppressions for a list of employee IDs.

    Returns:
        labels_map  — {emp_id: set of suppressed check_labels}
        infos_map   — {emp_id: list of SuppressionInfo (for display)}
    """
    if not emp_ids:
        return {}, {}

    stmt = (
        select(ComplianceSuppression)
        .where(
            ComplianceSuppression.employee_id.in_(emp_ids),
            ComplianceSuppression.is_active == True,  # noqa: E712
        )
    )
    result = await db.execute(stmt)
    suppressions = result.scalars().all()

    if not suppressions:
        return {}, {}

    # Resolve user display names in one query
    user_ids: set[int] = set()
    for s in suppressions:
        user_ids.add(s.suppressed_by_id)
        if s.undone_by_id:
            user_ids.add(s.undone_by_id)

    user_map: dict[int, str] = {}
    if user_ids:
        u_stmt = select(User).where(User.id.in_(user_ids))
        u_result = await db.execute(u_stmt)
        for u in u_result.scalars():
            user_map[u.id] = (u.name or "").strip() or u.email

    labels_map: dict[int, set[str]] = {}
    infos_map: dict[int, list[SuppressionInfo]] = {}
    for s in suppressions:
        labels_map.setdefault(s.employee_id, set()).add(s.check_label)
        infos_map.setdefault(s.employee_id, []).append(
            SuppressionInfo(
                id=s.id,
                check_label=s.check_label,
                reason=s.reason,
                suppressed_by_name=user_map.get(
                    s.suppressed_by_id, f"User #{s.suppressed_by_id}"
                ),
                suppressed_at=s.suppressed_at,
                undone_by_name=user_map.get(s.undone_by_id) if s.undone_by_id else None,
                undone_at=s.undone_at,
            )
        )

    return labels_map, infos_map


def _compliance(
    emp: Employee,
    suppressed_labels: set[str] | None = None,
    suppression_infos: list[SuppressionInfo] | None = None,
) -> EmployeeCompliance:
    result = cs.check_employee(
        proposed_award=emp.proposed_award,
        fy26_award=emp.fy26_award,
        proposed_rate=float(emp.proposed_rate) if emp.proposed_rate is not None else None,
        current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
        pp_level=emp.pp_level,
        age=emp.age,
        suppressed_labels=suppressed_labels,
    )
    return EmployeeCompliance(
        checks=[
            CheckResult(
                status=c.status,
                label=c.label,
                detail=c.detail,
                recommendation=c.recommendation,
            )
            for c in result.checks
        ],
        overall=result.overall,
        award_minimum=result.award_minimum,
        next_level=result.next_level,
        band_min=result.band_min,
        band_max=result.band_max,
        suppressions=suppression_infos or [],
    )


def _emp_with_compliance(
    emp: Employee,
    suppressed_labels: set[str] | None = None,
    suppression_infos: list[SuppressionInfo] | None = None,
) -> EmployeeWithCompliance:
    data = EmployeeWithCompliance.model_validate(emp)
    data.compliance = _compliance(emp, suppressed_labels, suppression_infos)
    return data


# ─────────────────────────────────────────────────────────────────────────────
#  Site summaries
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/cycles/{cycle_id}/sites", response_model=list[SiteSummary])
async def list_sites(
    cycle_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SiteSummary]:
    """Return one summary row per site for the given cycle."""
    await _get_cycle_or_404(db, cycle_id)
    employees = await cycle_service.get_cycle_employees(db, cycle_id)

    # Regional managers see only their own site
    if user.role == UserRole.REGIONAL_MANAGER.value and user.site:
        employees = [e for e in employees if e.site.lower() == user.site.lower()]

    # Gather all approvals in one query
    stmt = select(Approval).where(Approval.cycle_id == cycle_id)
    result = await db.execute(stmt)
    approvals: dict[str, str] = {
        row.site: row.status for row in result.scalars()
    }

    # Bulk-load suppressions for all active employees in this cycle
    active_emp_ids = [e.id for e in employees if not e.is_departed]
    sup_labels_map, _ = await _load_suppressions_for_employees(db, active_emp_ids)

    # Build per-site aggregates
    site_map: dict[str, dict] = {}
    for emp in employees:
        if emp.is_departed:
            continue
        site = emp.site
        if site not in site_map:
            site_map[site] = {
                "staff": 0,
                "payroll_current": 0.0,
                "payroll_proposed": 0.0,
                "below_award": 0,
                "no_proposed_rate": 0,
                "unknown_level": 0,
            }
        s = site_map[site]
        s["staff"] += 1
        hours = float(emp.hours_per_week or 0)
        s["payroll_current"] += float(emp.current_rate or 0) * hours * 52
        s["payroll_proposed"] += float(emp.proposed_rate or 0) * hours * 52

        comp = cs.check_employee(
            proposed_award=emp.proposed_award,
            fy26_award=emp.fy26_award,
            proposed_rate=float(emp.proposed_rate) if emp.proposed_rate is not None else None,
            current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
            pp_level=emp.pp_level,
            age=emp.age,
            suppressed_labels=sup_labels_map.get(emp.id),
        )
        # Classification issue (suppressed ones don't count)
        classif = next((c for c in comp.checks if c.label == "Classification"), None)
        if classif and classif.status not in ("ok", "suppressed"):
            s["unknown_level"] += 1
        # No proposed rate
        if not emp.proposed_rate:
            s["no_proposed_rate"] += 1
        # Below award floor or junior rate fail (only counted when a rate IS set)
        if emp.proposed_rate and any(
            c.label in ("Award floor", "Junior rate") and c.status == "fail"
            for c in comp.checks
        ):
            s["below_award"] += 1

    rows = []
    for site, s in sorted(site_map.items()):
        rows.append(
            SiteSummary(
                site=site,
                staff=s["staff"],
                payroll_current=round(s["payroll_current"], 2),
                payroll_proposed=round(s["payroll_proposed"], 2),
                issues=SiteIssues(
                    below_award=s["below_award"],
                    no_proposed_rate=s["no_proposed_rate"],
                    unknown_level=s["unknown_level"],
                ),
                approval_status=approvals.get(site, ApprovalStatus.NOT_SUBMITTED.value),
            )
        )
    return rows


# ─────────────────────────────────────────────────────────────────────────────
#  Site employees with compliance
# ─────────────────────────────────────────────────────────────────────────────
@router.get(
    "/cycles/{cycle_id}/sites/{site}/employees",
    response_model=list[EmployeeWithCompliance],
)
async def site_employees(
    cycle_id: int,
    site: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[EmployeeWithCompliance]:
    site = unquote(site)
    await _get_cycle_or_404(db, cycle_id)

    # Regional managers can only access their own site
    if (
        user.role == UserRole.REGIONAL_MANAGER.value
        and user.site
        and user.site.lower() != site.lower()
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    employees = await cycle_service.get_cycle_employees(db, cycle_id)
    site_emps = [e for e in employees if e.site.lower() == site.lower()]

    # Bulk-load suppressions for all employees in this site
    emp_ids = [e.id for e in site_emps]
    labels_map, infos_map = await _load_suppressions_for_employees(db, emp_ids)

    return [
        _emp_with_compliance(
            e,
            suppressed_labels=labels_map.get(e.id),
            suppression_infos=infos_map.get(e.id),
        )
        for e in site_emps
    ]


# ─────────────────────────────────────────────────────────────────────────────
#  Employee PATCH
# ─────────────────────────────────────────────────────────────────────────────
@router.patch("/employees/{emp_id}", response_model=EmployeeWithCompliance)
async def patch_employee(
    emp_id: int,
    body: EmployeePatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> EmployeeWithCompliance:
    emp = await db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    # Regional managers can only edit their own site
    if (
        user.role == UserRole.REGIONAL_MANAGER.value
        and user.site
        and user.site.lower() != emp.site.lower()
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    # Lock edits when site is approved (nobody can edit)
    # When pending: regional managers are locked out, but HR Admin / Senior Management
    # can still make final adjustments before approving.
    appr = await _get_approval(db, emp.cycle_id, emp.site)
    if appr and appr.status == ApprovalStatus.APPROVED.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This site has been approved — edits are locked.",
        )
    if appr and appr.status == ApprovalStatus.PENDING.value:
        if user.role == UserRole.REGIONAL_MANAGER.value:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This site is pending approval — edits are locked. Recall the submission first.",
            )

    changed_fields: dict = {}

    # ── change_type + change_input → recalculate proposed_rate ───────────────
    if body.change_type is not None:
        emp.change_type = body.change_type or None
        changed_fields["change_type"] = emp.change_type

    if body.change_input is not None:
        emp.change_input = body.change_input
        changed_fields["change_input"] = float(emp.change_input)

    if "change_type" in changed_fields or "change_input" in changed_fields:
        new_proposed = cycle_service.calc_proposed_rate(
            current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
            change_type=emp.change_type or "No Change",
            change_input=float(emp.change_input) if emp.change_input is not None else 0.0,
        )
        if new_proposed is not None:
            emp.proposed_rate = new_proposed
            changed_fields["proposed_rate"] = new_proposed

    # ── proposed_award (accepted next-level suggestion) ───────────────────────
    if body.proposed_award is not None:
        # Empty string = clear the accepted level
        emp.proposed_award = body.proposed_award or None
        changed_fields["proposed_award"] = emp.proposed_award

    # ── pp_level (identity field — editable from review UI) ──────────────────
    if body.pp_level is not None:
        emp.pp_level = body.pp_level or None
        changed_fields["pp_level"] = emp.pp_level

    # ── letter_type / notes ───────────────────────────────────────────────────
    if body.letter_type is not None:
        emp.letter_type = body.letter_type or None
        changed_fields["letter_type"] = emp.letter_type

    if body.notes is not None:
        emp.notes = body.notes or None
        changed_fields["notes"] = emp.notes

    # Auto-infer letter type whenever rate OR proposed_award changed
    if "letter_type" not in changed_fields and (
        "proposed_rate" in changed_fields or "proposed_award" in changed_fields
    ):
        inferred = cs.infer_letter_type(
            fy26_award=emp.fy26_award,
            proposed_award=emp.proposed_award,
            proposed_rate=float(emp.proposed_rate) if emp.proposed_rate is not None else None,
            current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
        )
        if inferred:
            emp.letter_type = inferred
            changed_fields["letter_type"] = inferred

    if changed_fields:
        db.add(
            AuditLog(
                user_id=user.id,
                action="employee_updated",
                entity_type="employee",
                entity_id=emp.id,
                detail={"changes": changed_fields},
            )
        )
        await db.commit()
        await db.refresh(emp)

    # Load suppressions so the response reflects any acknowledged warnings
    labels_map, infos_map = await _load_suppressions_for_employees(db, [emp.id])
    return _emp_with_compliance(
        emp,
        suppressed_labels=labels_map.get(emp.id),
        suppression_infos=infos_map.get(emp.id),
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Bulk suggest
# ─────────────────────────────────────────────────────────────────────────────
@router.post(
    "/cycles/{cycle_id}/bulk-suggest",
    response_model=BulkSuggestResponse,
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value, UserRole.REGIONAL_MANAGER.value))],
)
async def bulk_suggest(
    cycle_id: int,
    body: BulkSuggestRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BulkSuggestResponse:
    """Auto-fill proposed_rate for employees that don't yet have one."""
    cycle = await _get_cycle_or_404(db, cycle_id)
    employees = await cycle_service.get_cycle_employees(db, cycle_id)

    # Filter scope
    if body.site:
        employees = [e for e in employees if e.site.lower() == body.site.lower()]
    # Regional managers limited to their own site
    if user.role == UserRole.REGIONAL_MANAGER.value and user.site:
        employees = [e for e in employees if e.site.lower() == user.site.lower()]

    updated = 0
    skipped = 0
    cpi_rate = float(cycle.cpi_rate)
    for emp in employees:
        if emp.is_departed:
            continue
        if emp.proposed_rate is not None and emp.proposed_rate > 0:
            skipped += 1
            continue
        # Use employee's stored change_type/change_input or fall back to CPI defaults
        change_type = emp.change_type or "CPI Increase"
        change_input = float(emp.change_input) if emp.change_input is not None else cpi_rate
        suggested = cycle_service.calc_proposed_rate(
            current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
            change_type=change_type,
            change_input=change_input,
        )
        if suggested is None:
            skipped += 1
            continue
        emp.proposed_rate = suggested
        if not emp.change_type:
            emp.change_type = "CPI Increase"
        if not emp.change_input:
            emp.change_input = cpi_rate
        # Infer letter type
        inferred = cs.infer_letter_type(
            fy26_award=emp.fy26_award,
            proposed_award=emp.proposed_award,
            proposed_rate=suggested,
            current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
        )
        if inferred and not emp.letter_type:
            emp.letter_type = inferred
        updated += 1

    if updated:
        db.add(
            AuditLog(
                user_id=user.id,
                action="bulk_suggest_rates",
                entity_type="review_cycle",
                entity_id=cycle_id,
                detail={"site": body.site, "updated": updated, "skipped": skipped},
            )
        )
        await db.commit()

    return BulkSuggestResponse(updated=updated, skipped=skipped)


# ─────────────────────────────────────────────────────────────────────────────
#  Bulk assign letters
# ─────────────────────────────────────────────────────────────────────────────
@router.post(
    "/cycles/{cycle_id}/sites/{site}/assign-letters",
    response_model=BulkAssignLettersResponse,
)
async def bulk_assign_letters(
    cycle_id: int,
    site: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BulkAssignLettersResponse:
    """Infer and assign letter types for all active employees in a site.

    Runs infer_letter_type() on every active employee that has a proposed rate.
    Employees without a proposed rate are skipped.
    Already-assigned letter types are overwritten — this is intentional so that
    accepting a level change (proposed_award) is reflected across the whole site
    in one click.
    """
    site = unquote(site)
    await _get_cycle_or_404(db, cycle_id)

    # Regional managers can only touch their own site
    if (
        user.role == UserRole.REGIONAL_MANAGER.value
        and user.site
        and user.site.lower() != site.lower()
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    # Lock if approved
    appr = await _get_approval(db, cycle_id, site)
    if appr and appr.status == ApprovalStatus.APPROVED.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This site has been approved — edits are locked.",
        )

    employees = await cycle_service.get_cycle_employees(db, cycle_id)
    site_emps = [
        e for e in employees
        if e.site.lower() == site.lower() and not e.is_departed
    ]

    updated = 0
    skipped = 0
    for emp in site_emps:
        if emp.proposed_rate is None:
            skipped += 1
            continue
        inferred = cs.infer_letter_type(
            fy26_award=emp.fy26_award,
            proposed_award=emp.proposed_award,
            proposed_rate=float(emp.proposed_rate),
            current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
        )
        if inferred and emp.letter_type != inferred:
            emp.letter_type = inferred
            updated += 1
        elif not inferred:
            skipped += 1

    if updated:
        db.add(
            AuditLog(
                user_id=user.id,
                action="bulk_assign_letters",
                entity_type="review_cycle",
                entity_id=cycle_id,
                detail={"site": site, "updated": updated, "skipped": skipped},
            )
        )
        await db.commit()

    return BulkAssignLettersResponse(updated=updated, skipped=skipped)


# ─────────────────────────────────────────────────────────────────────────────
#  Approvals list (Phase 4)
# ─────────────────────────────────────────────────────────────────────────────
@router.get(
    "/cycles/{cycle_id}/approvals",
    response_model=list[ApprovalDetail],
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value, UserRole.SENIOR_MANAGEMENT.value))],
)
async def list_approvals(
    cycle_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ApprovalDetail]:
    """Return all submitted approvals for a cycle with site aggregates."""
    await _get_cycle_or_404(db, cycle_id)

    # Fetch all approvals that have been submitted (exclude not_submitted)
    stmt = select(Approval).where(
        Approval.cycle_id == cycle_id,
        Approval.status != ApprovalStatus.NOT_SUBMITTED.value,
    )
    result = await db.execute(stmt)
    approvals = result.scalars().all()

    if not approvals:
        return []

    # Get all employees to compute site aggregates
    employees = await cycle_service.get_cycle_employees(db, cycle_id)
    active_employees = [e for e in employees if not e.is_departed]

    # Bulk-load suppressions so site hard-issue counts are accurate
    all_emp_ids = [e.id for e in active_employees]
    sup_labels_map, _ = await _load_suppressions_for_employees(db, all_emp_ids)

    # Pre-compute per-site aggregates
    site_stats: dict[str, dict] = {}
    for emp in active_employees:
        s = site_stats.setdefault(emp.site, {
            "staff": 0, "payroll_current": 0.0,
            "payroll_proposed": 0.0, "hard_issues": 0, "warn_count": 0,
        })
        s["staff"] += 1
        hours = float(emp.hours_per_week or 0)
        s["payroll_current"] += float(emp.current_rate or 0) * hours * 52
        s["payroll_proposed"] += float(emp.proposed_rate or 0) * hours * 52
        comp = cs.check_employee(
            proposed_award=emp.proposed_award,
            fy26_award=emp.fy26_award,
            proposed_rate=float(emp.proposed_rate) if emp.proposed_rate is not None else None,
            current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
            pp_level=emp.pp_level,
            age=emp.age,
            suppressed_labels=sup_labels_map.get(emp.id),
        )
        if comp.overall == "fail":
            s["hard_issues"] += 1
        # Count employees with at least one active (non-suppressed) warning
        if any(c.status == "warn" for c in comp.checks):
            s["warn_count"] += 1

    # Resolve user display names in one query
    user_ids = {
        uid for a in approvals
        for uid in (a.submitted_by_id, a.decided_by_id) if uid
    }
    user_map: dict[int, str] = {}
    if user_ids:
        u_stmt = select(User).where(User.id.in_(user_ids))
        u_result = await db.execute(u_stmt)
        for u in u_result.scalars():
            user_map[u.id] = u.name.strip() or u.email

    rows = []
    for appr in sorted(approvals, key=lambda a: a.site):
        stats = site_stats.get(appr.site, {
            "staff": 0, "payroll_current": 0.0,
            "payroll_proposed": 0.0, "hard_issues": 0,
        })
        rows.append(ApprovalDetail(
            id=appr.id,
            site=appr.site,
            status=appr.status,
            staff=stats["staff"],
            payroll_current=round(stats["payroll_current"], 2),
            payroll_proposed=round(stats["payroll_proposed"], 2),
            hard_issues=stats["hard_issues"],
            warn_count=stats["warn_count"],
            submitted_by=user_map.get(appr.submitted_by_id) if appr.submitted_by_id else None,
            submitted_at=appr.submitted_at,
            submission_notes=appr.submission_notes,
            decided_by=user_map.get(appr.decided_by_id) if appr.decided_by_id else None,
            decided_at=appr.decided_at,
            decision_notes=appr.decision_notes,
        ))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
#  Submit site for approval
# ─────────────────────────────────────────────────────────────────────────────
@router.post(
    "/cycles/{cycle_id}/sites/{site}/submit",
    response_model=SubmitSiteResponse,
    dependencies=[
        Depends(
            require_roles(
                UserRole.HR_ADMIN.value,
                UserRole.REGIONAL_MANAGER.value,
            )
        )
    ],
)
async def submit_site(
    cycle_id: int,
    site: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SubmitSiteResponse:
    site = unquote(site)
    await _get_cycle_or_404(db, cycle_id)

    # Count hard compliance issues
    employees = await cycle_service.get_cycle_employees(db, cycle_id)
    site_emps = [
        e for e in employees
        if e.site.lower() == site.lower() and not e.is_departed
    ]
    hard_issues = sum(
        1
        for e in site_emps
        if not cs.check_employee(
            proposed_award=e.proposed_award,
            fy26_award=e.fy26_award,
            proposed_rate=float(e.proposed_rate) if e.proposed_rate is not None else None,
            current_rate=float(e.current_rate) if e.current_rate is not None else None,
            pp_level=e.pp_level,
            age=e.age,
        ).is_ok
    )

    if hard_issues > 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Cannot submit — {hard_issues} employee{'s have' if hard_issues != 1 else ' has'} "
            f"hard compliance failures. Resolve all Award floor and Junior rate issues first.",
        )

    appr = await _get_or_create_approval(db, cycle_id, site)
    appr.status = ApprovalStatus.PENDING.value
    appr.submitted_by_id = user.id
    appr.submitted_at = datetime.now(timezone.utc)

    db.add(
        AuditLog(
            user_id=user.id,
            action="site_submitted",
            entity_type="approval",
            entity_id=appr.id,
            detail={"site": site, "hard_issues": hard_issues},
        )
    )
    await db.commit()

    return SubmitSiteResponse(
        site=site,
        status="pending",
        issues_count=hard_issues,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Approval decision (senior management)
# ─────────────────────────────────────────────────────────────────────────────
@router.post(
    "/cycles/{cycle_id}/sites/{site}/decide",
    response_model=ApprovalDecisionResponse,
    dependencies=[
        Depends(
            require_roles(
                UserRole.HR_ADMIN.value,
                UserRole.SENIOR_MANAGEMENT.value,
            )
        )
    ],
)
async def decide_site(
    cycle_id: int,
    site: str,
    body: ApprovalDecisionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ApprovalDecisionResponse:
    site = unquote(site)
    await _get_cycle_or_404(db, cycle_id)

    appr = await _get_approval(db, cycle_id, site)
    if not appr or appr.status != ApprovalStatus.PENDING.value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Site is not pending approval",
        )

    new_status = (
        ApprovalStatus.APPROVED.value
        if body.decision == "approve"
        else ApprovalStatus.CHANGES_REQUESTED.value
    )
    appr.status = new_status
    appr.decided_by_id = user.id
    appr.decided_at = datetime.now(timezone.utc)
    appr.decision_notes = body.comment

    db.add(
        AuditLog(
            user_id=user.id,
            action=f"site_{body.decision}d",
            entity_type="approval",
            entity_id=appr.id,
            detail={"site": site, "comment": body.comment},
        )
    )
    await db.commit()

    # ── Generate output files on approval (non-blocking — never fails the response) ─
    if body.decision == "approve":
        try:
            import re as _re
            cycle = await _get_cycle_or_404(db, cycle_id)
            all_emps = await cycle_service.get_cycle_employees(db, cycle_id)
            site_emps = [e for e in all_emps if e.site.lower() == site.lower()]

            out_dir = storage.outputs_dir(cycle_id, site)
            safe_site = _re.sub(r'[\\/*?:"<>|]', "_", site)
            safe_fy = cycle.fy_label.replace("/", "-")
            generated: list[GeneratedFile] = []

            for file_type, filename, generator in [
                ("letters_zip",    f"PayLetters_{safe_site}_{safe_fy}.zip",     lambda p: doc_service.generate_letters_zip(site_emps, cycle, p)),
                ("ukg_upload",     f"UKG_Payroll_{safe_site}_{safe_fy}.xlsx",   lambda p: doc_service.generate_ukg_upload(site_emps, cycle, p)),
                ("regional_excel", f"ApprovedRates_{safe_site}_{safe_fy}.xlsx", lambda p: doc_service.generate_regional_excel(site_emps, cycle, site, p)),
            ]:
                try:
                    file_path = out_dir / filename
                    generator(file_path)
                    generated.append(GeneratedFile(
                        cycle_id=cycle_id, site=site,
                        file_type=file_type, filename=filename,
                        file_path=str(file_path),
                        file_size=file_path.stat().st_size if file_path.exists() else None,
                        generated_by_id=user.id,
                    ))
                except Exception as exc:
                    print(f"[documents] {file_type} failed for {site}: {exc}")

            for gf in generated:
                db.add(gf)
            if generated:
                await db.commit()
        except Exception as exc:
            print(f"[documents] generation block failed for {site}: {exc}")

    return ApprovalDecisionResponse(site=site, status=new_status)  # type: ignore[arg-type]


# ─────────────────────────────────────────────────────────────────────────────
#  Regenerate output files for an already-approved site
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/cycles/{cycle_id}/sites/{site}/regenerate-files")
async def regenerate_site_files(
    cycle_id: int,
    site: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.HR_ADMIN.value)),
) -> dict:
    """Re-generate all output files for an already-approved site (HR Admin only).

    Deletes stale GeneratedFile records for the site, then re-runs the three
    generators so the downloaded files reflect the current code (e.g. PDFs
    instead of DOCX).
    """
    import re as _re

    decoded_site = unquote(site)

    # Verify the site is approved
    stmt = select(Approval).where(
        Approval.cycle_id == cycle_id,
        func.lower(Approval.site) == decoded_site.lower(),
    )
    approval = (await db.execute(stmt)).scalar_one_or_none()
    if not approval or approval.status != ApprovalStatus.APPROVED.value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Site must be approved before regenerating files",
        )

    cycle = await _get_cycle_or_404(db, cycle_id)
    all_emps = await cycle_service.get_cycle_employees(db, cycle_id)
    site_emps = [e for e in all_emps if e.site.lower() == decoded_site.lower()]

    # Remove stale GeneratedFile rows (and the files on disk will be overwritten)
    await db.execute(
        sql_delete(GeneratedFile).where(
            GeneratedFile.cycle_id == cycle_id,
            func.lower(GeneratedFile.site) == decoded_site.lower(),
        )
    )
    await db.flush()

    out_dir = storage.outputs_dir(cycle_id, decoded_site)
    safe_site = _re.sub(r'[\\/*?:"<>|]', "_", decoded_site)
    safe_fy = cycle.fy_label.replace("/", "-")
    generated: list[GeneratedFile] = []

    for file_type, filename, generator in [
        ("letters_zip",    f"PayLetters_{safe_site}_{safe_fy}.zip",     lambda p: doc_service.generate_letters_zip(site_emps, cycle, p)),
        ("ukg_upload",     f"UKG_Payroll_{safe_site}_{safe_fy}.xlsx",   lambda p: doc_service.generate_ukg_upload(site_emps, cycle, p)),
        ("regional_excel", f"ApprovedRates_{safe_site}_{safe_fy}.xlsx", lambda p: doc_service.generate_regional_excel(site_emps, cycle, decoded_site, p)),
    ]:
        try:
            file_path = out_dir / filename
            generator(file_path)
            generated.append(GeneratedFile(
                cycle_id=cycle_id,
                site=decoded_site,
                file_type=file_type,
                filename=filename,
                file_path=str(file_path),
                file_size=file_path.stat().st_size if file_path.exists() else None,
                generated_by_id=user.id,
            ))
        except Exception as exc:
            print(f"[regenerate] {file_type} failed for {decoded_site}: {exc}")

    for gf in generated:
        db.add(gf)
    await db.commit()

    return {"regenerated": len(generated), "site": decoded_site}


# ─────────────────────────────────────────────────────────────────────────────
#  Compliance suppression  (acknowledge / un-acknowledge non-rate warnings)
# ─────────────────────────────────────────────────────────────────────────────

# Hard-fail checks that are legal obligations — cannot be suppressed
_UNSUPPRESSIBLE_CHECKS = {"Award floor", "Junior rate", "Pay progression"}


@router.post(
    "/employees/{emp_id}/suppress-check",
    response_model=EmployeeWithCompliance,
)
async def suppress_check(
    emp_id: int,
    body: SuppressCheckRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> EmployeeWithCompliance:
    """Mark a compliance warning as acknowledged / noted externally.

    Only `warn`-level checks can be suppressed.  Hard-fail checks (Award floor,
    Junior rate) are legal obligations and cannot be acknowledged away.
    """
    emp = await db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    if body.check_label in _UNSUPPRESSIBLE_CHECKS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"'{body.check_label}' is a legal compliance requirement and cannot be suppressed.",
        )

    # Verify the check actually exists and is a warn for this employee
    comp = cs.check_employee(
        proposed_award=emp.proposed_award,
        fy26_award=emp.fy26_award,
        proposed_rate=float(emp.proposed_rate) if emp.proposed_rate is not None else None,
        current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
        pp_level=emp.pp_level,
        age=emp.age,
    )
    matching = next((c for c in comp.checks if c.label == body.check_label), None)
    if matching is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"No check named '{body.check_label}' found for this employee.",
        )
    if matching.status == "fail":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"'{body.check_label}' is a hard compliance failure and cannot be suppressed.",
        )

    # Check for existing active suppression
    stmt = select(ComplianceSuppression).where(
        ComplianceSuppression.employee_id == emp_id,
        ComplianceSuppression.check_label == body.check_label,
        ComplianceSuppression.is_active == True,  # noqa: E712
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This check is already acknowledged for this employee.",
        )

    suppression = ComplianceSuppression(
        employee_id=emp_id,
        check_label=body.check_label,
        reason=body.reason,
        is_active=True,
        suppressed_by_id=user.id,
        suppressed_at=datetime.now(timezone.utc),
    )
    db.add(suppression)
    db.add(
        AuditLog(
            user_id=user.id,
            action="suppress_check",
            entity_type="employee",
            entity_id=emp_id,
            detail={"check_label": body.check_label, "reason": body.reason},
        )
    )
    await db.commit()
    await db.refresh(emp)

    labels_map, infos_map = await _load_suppressions_for_employees(db, [emp_id])
    return _emp_with_compliance(emp, labels_map.get(emp_id), infos_map.get(emp_id))


@router.delete(
    "/employees/{emp_id}/suppress-check/{check_label}",
    response_model=EmployeeWithCompliance,
)
async def unsuppress_check(
    emp_id: int,
    check_label: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> EmployeeWithCompliance:
    """Undo an acknowledged warning — restores it to active warn state."""
    emp = await db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    check_label = unquote(check_label)

    stmt = select(ComplianceSuppression).where(
        ComplianceSuppression.employee_id == emp_id,
        ComplianceSuppression.check_label == check_label,
        ComplianceSuppression.is_active == True,  # noqa: E712
    )
    suppression = (await db.execute(stmt)).scalar_one_or_none()
    if not suppression:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No active acknowledgement found for this check.",
        )

    suppression.is_active = False
    suppression.undone_by_id = user.id
    suppression.undone_at = datetime.now(timezone.utc)

    db.add(
        AuditLog(
            user_id=user.id,
            action="unsuppress_check",
            entity_type="employee",
            entity_id=emp_id,
            detail={"check_label": check_label},
        )
    )
    await db.commit()
    await db.refresh(emp)

    labels_map, infos_map = await _load_suppressions_for_employees(db, [emp_id])
    return _emp_with_compliance(emp, labels_map.get(emp_id), infos_map.get(emp_id))


# ─────────────────────────────────────────────────────────────────────────────
#  Draft letter PDF downloads
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/employees/{emp_id}/draft-letter")
async def get_draft_letter(
    emp_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Download a DRAFT pay-letter PDF for a single employee.

    Requires: letter_type assigned (A/B/C), proposed_rate set, compliance clean.
    """
    emp = await db.get(Employee, emp_id)
    if not emp:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    # Regional managers can only access their own site
    if (
        user.role == UserRole.REGIONAL_MANAGER.value
        and user.site
        and user.site.lower() != emp.site.lower()
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    letter_type = (emp.letter_type or "").upper().strip()
    if letter_type not in ("A", "B", "C"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Employee does not have a letter type assigned.",
        )
    if not emp.proposed_rate:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Employee does not have a proposed rate.",
        )

    # Compliance must be clean (including suppressed warns counting as ok)
    labels_map, _ = await _load_suppressions_for_employees(db, [emp_id])
    comp = cs.check_employee(
        proposed_award=emp.proposed_award,
        fy26_award=emp.fy26_award,
        proposed_rate=float(emp.proposed_rate),
        current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
        pp_level=emp.pp_level,
        age=emp.age,
        suppressed_labels=labels_map.get(emp_id),
    )
    if comp.overall != "ok":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Employee has unresolved compliance issues — resolve or acknowledge them first.",
        )

    cycle = await db.get(ReviewCycle, emp.cycle_id)
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")

    pdf_bytes = doc_service.generate_draft_letter_pdf(emp, cycle)

    import re as _re
    safe = lambda t: _re.sub(r'[\\/*?:"<>|]', "_", str(t or "unknown")).strip()
    filename = f"DRAFT_{safe(emp.last_name)}_{safe(emp.first_name)}_Letter{letter_type}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/cycles/{cycle_id}/sites/{site}/draft-letters.zip")
async def get_draft_letters_zip(
    cycle_id: int,
    site: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Download a ZIP of DRAFT pay-letter PDFs for all compliance-clean employees in a site."""
    import io
    import re as _re
    import zipfile

    site = unquote(site)
    cycle = await _get_cycle_or_404(db, cycle_id)

    # Regional managers can only access their own site
    if (
        user.role == UserRole.REGIONAL_MANAGER.value
        and user.site
        and user.site.lower() != site.lower()
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

    employees = await cycle_service.get_cycle_employees(db, cycle_id)
    site_emps = [
        e for e in employees
        if e.site.lower() == site.lower() and not e.is_departed
    ]

    emp_ids = [e.id for e in site_emps]
    labels_map, _ = await _load_suppressions_for_employees(db, emp_ids)

    safe = lambda t: _re.sub(r'[\\/*?:"<>|]', "_", str(t or "unknown")).strip()

    buf = io.BytesIO()
    count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for emp in site_emps:
            lt = (emp.letter_type or "").upper().strip()
            if lt not in ("A", "B", "C"):
                continue
            if not emp.proposed_rate:
                continue
            comp = cs.check_employee(
                proposed_award=emp.proposed_award,
                fy26_award=emp.fy26_award,
                proposed_rate=float(emp.proposed_rate),
                current_rate=float(emp.current_rate) if emp.current_rate is not None else None,
                pp_level=emp.pp_level,
                age=emp.age,
                suppressed_labels=labels_map.get(emp.id),
            )
            if comp.overall != "ok":
                continue
            try:
                pdf_bytes = doc_service.generate_draft_letter_pdf(emp, cycle)
            except Exception as exc:
                print(f"[draft-pdf] skipping emp {emp.id}: {exc}")
                continue
            fname = f"DRAFT_{safe(emp.last_name)}_{safe(emp.first_name)}_Letter{lt}.pdf"
            zf.writestr(fname, pdf_bytes)
            count += 1

    if count == 0:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No employees are ready for draft letters in this site yet.",
        )

    buf.seek(0)
    safe_site = _re.sub(r'[\\/*?:"<>|]', "_", site)
    zip_filename = f"DraftLetters_{safe_site}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
    )
