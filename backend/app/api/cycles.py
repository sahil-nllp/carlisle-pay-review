"""Review-cycle endpoints: upload, diff preview, apply, list, current, employees."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_roles
from app.database import get_db
from app.models import AuditLog, ReviewCycle, User, UserRole
from app.schemas.cycle import (
    CycleMetadata,
    CycleResponse,
    CycleSettingsRequest,
    EmployeeDiffRow,
    EmployeeResponse,
    UploadApplyRequest,
    UploadApplyResponse,
    UploadStagedResponse,
)
from app.services import cycles as cycle_service
from app.services import storage
from app.services.excel_parser import parse_wage_model

router = APIRouter(prefix="/cycles", tags=["cycles"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
PREVIEW_ROW_LIMIT = 200


# ─────────────────────────────────────────────────────────────────────────────
#  Read
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/current", response_model=CycleResponse | None)
async def current_cycle(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> CycleResponse | None:
    cycle = await cycle_service.get_active_cycle(db)
    return CycleResponse.model_validate(cycle) if cycle else None


@router.get("", response_model=list[CycleResponse])
async def list_cycles(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[CycleResponse]:
    cycles = await cycle_service.list_cycles(db)
    return [CycleResponse.model_validate(c) for c in cycles]


@router.get("/{cycle_id}/employees", response_model=list[EmployeeResponse])
async def cycle_employees(
    cycle_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[EmployeeResponse]:
    cycle = await db.get(ReviewCycle, cycle_id)
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    employees = await cycle_service.get_cycle_employees(db, cycle_id)

    # Regional managers see only their site
    if user.role == UserRole.REGIONAL_MANAGER.value and user.site:
        employees = [e for e in employees if e.site.lower() == user.site.lower()]

    return [EmployeeResponse.model_validate(e) for e in employees]


# ─────────────────────────────────────────────────────────────────────────────
#  Upload (two-step: stage → apply)
# ─────────────────────────────────────────────────────────────────────────────
@router.post(
    "/upload",
    response_model=UploadStagedResponse,
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
)
async def upload_wage_model(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UploadStagedResponse:
    """Step 1: upload and parse the wage model, return diff preview vs current cycle."""
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "File must be an .xlsx or .xlsm workbook"
        )

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit",
        )

    try:
        parsed = parse_wage_model(raw)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    # Save to staging
    staging_path = storage.save_to_staging(file.filename or "wage_model.xlsx", raw)

    # Compute diff vs current cycle (if any)
    current = await cycle_service.get_active_cycle(db)
    existing_employees = (
        await cycle_service.get_cycle_employees(db, current.id) if current else []
    )
    summary, diff_rows = cycle_service.compute_diff(parsed.employees, existing_employees)

    # Preview cap — keep changed/new/removed in priority order
    def sort_key(r: dict) -> int:
        order = {"changed": 0, "new": 1, "removed": 2, "unchanged": 3}
        return order.get(r["kind"], 9)

    preview = sorted(diff_rows, key=sort_key)[:PREVIEW_ROW_LIMIT]

    db.add(
        AuditLog(
            user_id=user.id,
            action="upload_wage_model_staged",
            detail={
                "filename": file.filename,
                "rows": len(parsed.employees),
                "summary": summary,
            },
        )
    )
    await db.commit()

    return UploadStagedResponse(
        staging_id=staging_path.name,
        filename=file.filename or staging_path.name,
        sheet_name=parsed.sheet_name,
        columns_detected=sorted(parsed.column_map.keys()),
        row_count=len(parsed.employees),
        warnings=parsed.warnings,
        current_cycle=CycleResponse.model_validate(current) if current else None,
        summary=summary,
        preview=[EmployeeDiffRow.model_validate(r) for r in preview],
    )


@router.post(
    "/upload/apply",
    response_model=UploadApplyResponse,
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
)
async def apply_upload(
    body: UploadApplyRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UploadApplyResponse:
    """Step 2: commit a previously-staged upload according to the chosen mode."""
    staging_path = storage.staging_dir() / body.staging_id
    if not staging_path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Staged file not found — please re-upload.",
        )

    # Parse again (cheaper than holding state server-side)
    parsed = parse_wage_model(staging_path.read_bytes())
    current = await cycle_service.get_active_cycle(db)

    inserted = 0
    updated = 0
    departed = 0
    cycle: ReviewCycle

    if body.mode == "merge":
        if not current:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Cannot merge — no active cycle to merge into.",
            )
        inserted, updated, departed = await cycle_service.merge_into_cycle(
            db, current, parsed.employees
        )
        # Replace stored wage-model file
        new_path = storage.move_to_cycle(staging_path, current.id, body.filename)
        current.wage_model_filename = body.filename
        current.wage_model_path = str(new_path)
        # Update metadata if user changed it
        current.fy_label = body.metadata.fy_label
        current.effective_date = body.metadata.effective_date
        current.letter_date = body.metadata.letter_date
        current.cpi_rate = body.metadata.cpi_rate
        await db.commit()
        await db.refresh(current)
        cycle = current

    else:
        if body.mode == "archive" and current:
            await cycle_service.archive_cycle(db, current)
        # Create the new cycle (file will be moved into its folder after creation)
        new_cycle_filename = body.filename
        # Stage a temporary path; actual path assigned once we have cycle_id
        cycle, inserted = await cycle_service.create_cycle_from_parse(
            db,
            fy_label=body.metadata.fy_label,
            effective_date=body.metadata.effective_date,
            letter_date=body.metadata.letter_date,
            cpi_rate=body.metadata.cpi_rate,
            wage_model_filename=new_cycle_filename,
            wage_model_path="(pending)",
            parsed=parsed.employees,
            created_by_id=user.id,
        )
        final_path = storage.move_to_cycle(staging_path, cycle.id, body.filename)
        cycle.wage_model_path = str(final_path)
        await db.commit()
        await db.refresh(cycle)

    db.add(
        AuditLog(
            user_id=user.id,
            action="upload_wage_model_applied",
            entity_type="review_cycle",
            entity_id=cycle.id,
            detail={
                "mode": body.mode,
                "inserted": inserted,
                "updated": updated,
                "departed": departed,
            },
        )
    )
    await db.commit()

    return UploadApplyResponse(
        cycle=CycleResponse.model_validate(cycle),
        employees_inserted=inserted,
        employees_updated=updated,
        employees_removed=departed,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Cycle settings PATCH (Phase 6)
# ─────────────────────────────────────────────────────────────────────────────
@router.patch(
    "/{cycle_id}/settings",
    response_model=CycleResponse,
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
)
async def update_cycle_settings(
    cycle_id: int,
    body: CycleSettingsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CycleResponse:
    """Update letter / signatory / rate settings on an existing cycle."""
    cycle = await db.get(ReviewCycle, cycle_id)
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")

    changed: dict = {}
    for field in (
        "letter_date", "effective_date", "consultation_deadline",
        "cpi_rate", "super_old", "super_new",
        "signatory_name", "signatory_title", "signatory_company", "hr_email",
    ):
        val = getattr(body, field)
        if val is not None:
            setattr(cycle, field, val)
            changed[field] = str(val)

    if changed:
        db.add(AuditLog(
            user_id=user.id,
            action="update_cycle_settings",
            entity_type="review_cycle",
            entity_id=cycle.id,
            detail=changed,
        ))
        await db.commit()
        await db.refresh(cycle)

    return CycleResponse.model_validate(cycle)


class CancelUploadRequest(BaseModel):
    staging_id: str


@router.post(
    "/upload/cancel",
    status_code=status.HTTP_200_OK,
    response_model=dict,
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
)
async def cancel_upload(
    body: CancelUploadRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Discard a staged upload."""
    staging_id = body.staging_id
    if not staging_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "staging_id is required")
    staging_path = storage.staging_dir() / staging_id
    storage.cleanup_staging(staging_path)
    db.add(
        AuditLog(
            user_id=user.id,
            action="upload_wage_model_cancelled",
            detail={"staging_id": staging_id},
        )
    )
    await db.commit()
    return {"ok": True}
