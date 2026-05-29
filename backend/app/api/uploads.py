"""Four-file upload flow (Phase 4 — replaces the old single wage-model upload).

Endpoints:
  POST /cycles/upload-files   — stage all 4 files in one multipart request,
                                parse + diff, return combined preview.
  POST /cycles/apply-upload   — commit a staged upload into a new (or existing)
                                cycle, in one DB transaction.
  POST /cycles/cancel-upload  — discard a staging session.

The 4 files expected (form-field names):
  - employee_file    → Employee_Details.xlsx
  - award_summary    → Award Summary.xlsx
  - pp_admin         → Pay Progression Admin.xlsx
  - pp_tech          → Pay Progression Tech.xlsx
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_roles
from app.database import get_db
from app.models import AuditLog, CycleStatus, ReviewCycle, User, UserRole
from app.schemas.cycle import CycleResponse, EmployeeDiffRow
from app.schemas.upload import (
    ApplyUploadRequest,
    ApplyUploadResponse,
    AwardSummaryFileSummary,
    CancelStagingRequest,
    EmployeeFileSummary,
    PPFileSummary,
    StagedUploadResponse,
)
from app.services import cycles as cycle_service
from app.services import storage
from app.services.parsers import (
    parse_award_summary,
    parse_employee_details,
    parse_pp_admin,
    parse_pp_tech,
)

router = APIRouter(prefix="/cycles", tags=["uploads"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB per file
PREVIEW_ROW_LIMIT = 200

# Filenames inside the staging session dir (constant — easier than tracking in DB)
EMP_FILENAME = "employee_details.xlsx"
AWARD_FILENAME = "award_summary.xlsx"
PP_ADMIN_FILENAME = "pp_admin.xlsx"
PP_TECH_FILENAME = "pp_tech.xlsx"


# ─────────────────────────────────────────────────────────────────────────────
#  Step 1 — stage 4 files together
# ─────────────────────────────────────────────────────────────────────────────
@router.post(
    "/upload-files",
    response_model=StagedUploadResponse,
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
)
async def upload_files(
    employee_file: UploadFile = File(..., description="Employee_Details.xlsx"),
    award_summary: UploadFile = File(..., description="Award Summary.xlsx"),
    pp_admin: UploadFile = File(..., description="Pay Progression Admin.xlsx"),
    pp_tech: UploadFile = File(..., description="Pay Progression Tech.xlsx"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StagedUploadResponse:
    """Stage all 4 files and return a combined parse + diff preview."""
    files = [
        (employee_file, EMP_FILENAME, "employee_file"),
        (award_summary, AWARD_FILENAME, "award_summary"),
        (pp_admin, PP_ADMIN_FILENAME, "pp_admin"),
        (pp_tech, PP_TECH_FILENAME, "pp_tech"),
    ]

    # Validate types + sizes before doing any work
    for upload, _, label in files:
        if not (upload.filename or "").lower().endswith((".xlsx", ".xlsm")):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{label}: must be an .xlsx or .xlsm workbook (got {upload.filename!r})",
            )

    # Read all files into memory + write into a staging session
    staging_id, session_dir = storage.new_staging_session()

    raw_bytes: dict[str, bytes] = {}
    raw_filenames: dict[str, str] = {}
    try:
        for upload, target_name, label in files:
            data = await upload.read()
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    f"{label}: file exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
                )
            storage.save_to_session(session_dir, target_name, data)
            raw_bytes[label] = data
            raw_filenames[label] = upload.filename or target_name
    except HTTPException:
        storage.cleanup_staging_session(staging_id)
        raise

    # Parse all 4 files
    try:
        current = await cycle_service.get_active_cycle(db)
        # Use the cycle's effective_date when computing ages, falling back to today
        eff_date = current.effective_date if current else None

        emp_result = parse_employee_details(raw_bytes["employee_file"], effective_date=eff_date)
        award_result = parse_award_summary(raw_bytes["award_summary"])
        admin_result = parse_pp_admin(raw_bytes["pp_admin"])
        tech_result = parse_pp_tech(raw_bytes["pp_tech"])
    except ValueError as e:
        storage.cleanup_staging_session(staging_id)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    # Compute employee diff vs current cycle
    existing_employees = (
        await cycle_service.get_cycle_employees(db, current.id) if current else []
    )
    diff_summary, diff_rows = cycle_service.compute_diff(
        emp_result.employees, existing_employees
    )

    # Cap preview, prioritising changed > new > removed
    def sort_key(r: dict) -> int:
        order = {"changed": 0, "new": 1, "removed": 2, "unchanged": 3}
        return order.get(r["kind"], 9)

    preview = sorted(diff_rows, key=sort_key)[:PREVIEW_ROW_LIMIT]

    # Audit
    db.add(
        AuditLog(
            user_id=user.id,
            action="upload_files_staged",
            detail={
                "staging_id": staging_id,
                "employees": len(emp_result.employees),
                "award_rates": len(award_result.rates),
                "pp_admin_bands": len(admin_result.bands),
                "pp_tech_bands": len(tech_result.bands),
            },
        )
    )
    await db.commit()

    return StagedUploadResponse(
        staging_id=staging_id,
        employee_file=EmployeeFileSummary(
            filename=raw_filenames["employee_file"],
            sheet_name=emp_result.sheet_name,
            columns_detected=sorted(emp_result.column_map.keys()),
            employees_parsed=len(emp_result.employees),
            warnings=emp_result.warnings,
        ),
        award_summary=AwardSummaryFileSummary(
            filename=raw_filenames["award_summary"],
            sheet_name=award_result.sheet_name,
            award_rates=sum(1 for r in award_result.rates if not r.is_off_award),
            off_award_rows=sum(1 for r in award_result.rates if r.is_off_award),
            junior_rates=len(award_result.junior_rates),
            warnings=award_result.warnings,
        ),
        pp_admin=PPFileSummary(
            filename=raw_filenames["pp_admin"],
            sheet_name=admin_result.sheet_name,
            stream="admin",
            bands=len(admin_result.bands),
            sections=sorted({b.section_header for b in admin_result.bands if b.section_header}),
            warnings=admin_result.warnings,
        ),
        pp_tech=PPFileSummary(
            filename=raw_filenames["pp_tech"],
            sheet_name=tech_result.sheet_name,
            stream="tech",
            bands=len(tech_result.bands),
            sections=sorted({b.section_header for b in tech_result.bands if b.section_header}),
            warnings=tech_result.warnings,
        ),
        current_cycle=CycleResponse.model_validate(current) if current else None,
        employee_diff_summary=diff_summary,
        employee_diff_preview=[EmployeeDiffRow.model_validate(r) for r in preview],
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Step 2 — apply staged upload to a cycle
# ─────────────────────────────────────────────────────────────────────────────
@router.post(
    "/apply-upload",
    response_model=ApplyUploadResponse,
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
)
async def apply_upload(
    body: ApplyUploadRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ApplyUploadResponse:
    """Commit a previously-staged 4-file upload to a new or existing cycle."""
    session_dir = storage.staging_session_path(body.staging_id)
    if not session_dir.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Staging session not found — please re-upload the files.",
        )

    # Re-parse all 4 from disk (cheap, avoids holding state)
    current = await cycle_service.get_active_cycle(db)
    eff_for_parse = body.metadata.effective_date

    try:
        emp_result = parse_employee_details(
            (session_dir / EMP_FILENAME).read_bytes(),
            effective_date=eff_for_parse,
        )
        award_result = parse_award_summary((session_dir / AWARD_FILENAME).read_bytes())
        admin_result = parse_pp_admin((session_dir / PP_ADMIN_FILENAME).read_bytes())
        tech_result = parse_pp_tech((session_dir / PP_TECH_FILENAME).read_bytes())
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    # ── Resolve target cycle based on mode ────────────────────────────────────
    cycle: ReviewCycle
    if body.mode == "merge":
        if not current:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Cannot merge — no active cycle to merge into.",
            )
        cycle = current
        cycle.fy_label = body.metadata.fy_label
        cycle.effective_date = body.metadata.effective_date
        cycle.letter_date = body.metadata.letter_date
        cycle.cpi_rate = body.metadata.cpi_rate
    else:
        if body.mode == "archive" and current:
            await cycle_service.archive_cycle(db, current)
        cycle = ReviewCycle(
            fy_label=body.metadata.fy_label,
            effective_date=body.metadata.effective_date,
            letter_date=body.metadata.letter_date,
            cpi_rate=body.metadata.cpi_rate,
            status=CycleStatus.ACTIVE.value,
            created_by_id=user.id,
        )
        db.add(cycle)
        await db.flush()

    # ── Upsert employees ──────────────────────────────────────────────────────
    inserted, updated, departed = await cycle_service.upsert_employees(
        db, cycle=cycle, parsed=emp_result.employees
    )

    # ── Replace reference data ────────────────────────────────────────────────
    rates_count = await cycle_service.replace_award_rates(
        db, cycle.id, award_result.rates
    )
    juniors_count = await cycle_service.replace_junior_rates(
        db, cycle.id, award_result.junior_rates
    )
    # PP bands: replace then append both streams
    await cycle_service.replace_pp_bands(db, cycle.id, admin_result.bands)
    tech_count = await cycle_service.append_pp_bands(db, cycle.id, tech_result.bands)
    pp_total = len(admin_result.bands) + tech_count

    # ── Move staged files to cycle's permanent location ───────────────────────
    cycle_uploads = storage.uploads_dir(cycle.id)
    now = datetime.now(timezone.utc)

    def move(src_name: str, dest_name: str) -> str:
        src = session_dir / src_name
        dest = cycle_uploads / dest_name
        if src.exists():
            import shutil
            shutil.move(str(src), str(dest))
        return str(dest)

    cycle.employee_file_path = move(EMP_FILENAME, EMP_FILENAME)
    cycle.employee_file_uploaded_at = now
    cycle.award_summary_path = move(AWARD_FILENAME, AWARD_FILENAME)
    cycle.award_summary_uploaded_at = now
    cycle.pp_admin_path = move(PP_ADMIN_FILENAME, PP_ADMIN_FILENAME)
    cycle.pp_admin_uploaded_at = now
    cycle.pp_tech_path = move(PP_TECH_FILENAME, PP_TECH_FILENAME)
    cycle.pp_tech_uploaded_at = now
    cycle.reference_data_ready = True

    # Cleanup the (now empty) staging session
    storage.cleanup_staging_session(body.staging_id)

    db.add(
        AuditLog(
            user_id=user.id,
            action="upload_files_applied",
            entity_type="review_cycle",
            entity_id=cycle.id,
            detail={
                "mode": body.mode,
                "inserted": inserted,
                "updated": updated,
                "departed": departed,
                "award_rates": rates_count,
                "pp_bands": pp_total,
                "junior_rates": juniors_count,
            },
        )
    )
    await db.commit()
    await db.refresh(cycle)

    return ApplyUploadResponse(
        cycle=CycleResponse.model_validate(cycle),
        employees_inserted=inserted,
        employees_updated=updated,
        employees_removed=departed,
        award_rates_loaded=rates_count,
        pp_bands_loaded=pp_total,
        junior_rates_loaded=juniors_count,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Cancel staging
# ─────────────────────────────────────────────────────────────────────────────
@router.post(
    "/cancel-upload",
    status_code=status.HTTP_200_OK,
    response_model=dict,
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
)
async def cancel_staging(
    body: CancelStagingRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Discard a staged 4-file upload (user backed out)."""
    storage.cleanup_staging_session(body.staging_id)
    db.add(
        AuditLog(
            user_id=user.id,
            action="upload_files_cancelled",
            detail={"staging_id": body.staging_id},
        )
    )
    await db.commit()
    return {"ok": True}
