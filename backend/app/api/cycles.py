"""Review-cycle endpoints: list, current, employees, settings.

Upload routes live in `app.api.uploads` (Phase 4 — 4-file uploader).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_roles
from app.database import get_db
from app.models import AuditLog, AwardRate, PPBand, ReviewCycle, User, UserRole
from app.schemas.cycle import (
    CycleResponse,
    CycleSettingsRequest,
    EmployeeResponse,
)
from app.services import cycles as cycle_service

router = APIRouter(prefix="/cycles", tags=["cycles"])


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
#  Award rates for the dropdown (ordered for display)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/{cycle_id}/award-rates")
async def get_award_rates(
    cycle_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    """Return ordered award levels for this cycle (used to populate the award dropdown)."""
    cycle = await db.get(ReviewCycle, cycle_id)
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    result = await db.execute(
        select(AwardRate)
        .where(AwardRate.cycle_id == cycle_id)
        .order_by(AwardRate.display_order)
    )
    rates = result.scalars().all()
    return [
        {
            "award_level": r.award_level,
            "hourly_rate": float(r.hourly_rate) if r.hourly_rate is not None else None,
            "is_off_award": bool(r.is_off_award),
        }
        for r in rates
    ]


# ─────────────────────────────────────────────────────────────────────────────
#  Pay Progression bands (for PP-level dropdown in review UI)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/{cycle_id}/pp-bands")
async def get_pp_bands(
    cycle_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict]:
    """Return all Pay Progression bands for this cycle.

    Frontend filters client-side by selected award:
      - SS awards → exact match on `award_key`
      - HP awards → parse "HPSS HP L{n} PP{x}" and range-match against
        `award_key` like "HPL{n}.a-{n}.b"
    """
    cycle = await db.get(ReviewCycle, cycle_id)
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    result = await db.execute(
        select(PPBand)
        .where(PPBand.cycle_id == cycle_id)
        .order_by(PPBand.stream, PPBand.display_order)
    )
    bands = result.scalars().all()
    return [
        {
            "convention": b.convention,
            "award_key": b.award_key,
            "carlisle_label": b.carlisle_label,
            "stream": b.stream,
            "section_header": b.section_header,
            "award_level_group": b.award_level_group,
            "band_min": float(b.band_min) if b.band_min is not None else None,
            "band_max": float(b.band_max) if b.band_max is not None else None,
        }
        for b in bands
    ]


# ─────────────────────────────────────────────────────────────────────────────
#  Cycle settings PATCH
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
