"""Review-cycle endpoints: list, current, employees, settings.

Upload routes live in `app.api.uploads` (Phase 4 — 4-file uploader).
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
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
from app.services import cycles as cycle_service, storage

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
    return _cycle_response(cycle) if cycle else None


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

    # Regional managers see only their site(s) — site field may be comma-separated
    if user.role == UserRole.REGIONAL_MANAGER.value and user.site:
        allowed = {s.strip().lower() for s in user.site.split(",")}
        employees = [e for e in employees if e.site.lower() in allowed]

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
    # super_old / super_new are stored as VARCHAR (used as display strings in letters)
    VARCHAR_FIELDS = {"super_old", "super_new"}
    for field in (
        "letter_date", "effective_date", "consultation_deadline",
        "cpi_rate", "super_old", "super_new",
        "signatory_name", "signatory_title", "signatory_company", "hr_email",
    ):
        val = getattr(body, field)
        if val is not None:
            db_val = str(val) if field in VARCHAR_FIELDS else val
            setattr(cycle, field, db_val)
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

    return _cycle_response(cycle)


def _cycle_response(cycle: ReviewCycle) -> CycleResponse:
    r = CycleResponse.model_validate(cycle)
    r.has_signature = bool(cycle.signature_path and Path(cycle.signature_path).exists())
    return r


# ─────────────────────────────────────────────────────────────────────────────
#  Signature upload / serve / delete
# ─────────────────────────────────────────────────────────────────────────────
_SIGNATURE_DIR = storage.STORAGE_ROOT / "signatures"


@router.post(
    "/{cycle_id}/signature",
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
)
async def upload_signature(
    cycle_id: int,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    cycle = await db.get(ReviewCycle, cycle_id)
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "File must be an image (PNG or JPG)")

    _SIGNATURE_DIR.mkdir(parents=True, exist_ok=True)
    dest = _SIGNATURE_DIR / f"cycle_{cycle_id}_signature.png"  # always save as PNG (supports transparency)

    if cycle.signature_path:
        Path(cycle.signature_path).unlink(missing_ok=True)

    raw = await file.read()
    processed = _process_signature(raw)
    dest.write_bytes(processed)
    cycle.signature_path = str(dest)
    await db.commit()
    return {"has_signature": True}


def _process_signature(data: bytes) -> bytes:
    """Remove background from a signature image, keeping ink strokes crisp.

    Adaptive-threshold approach:
      1. Convert to greyscale (the ORIGINAL, never blurred).
      2. Estimate local paper brightness with a wide blur (radius far bigger
         than a pen stroke), so it captures shading/vignette but not the ink.
      3. Alpha comes from how much darker each pixel is than its local paper
         estimate — computed straight off the sharp original pixel, never off
         a blurred copy, so stroke edges stay sharp instead of feathering out.
    """
    import io

    import numpy as np
    from PIL import Image, ImageFilter

    img = Image.open(io.BytesIO(data)).convert("L")

    # Median filter kills single-pixel sensor/paper grain WITHOUT softening
    # real stroke edges (edge-preserving, unlike Gaussian blur) — strokes are
    # several pixels wide, grain is ~1px, so this only removes the latter.
    denoised = img.filter(ImageFilter.MedianFilter(size=3))
    arr = np.asarray(denoised, dtype=np.float32)

    # Wide blur = local paper/background estimate, not the strokes themselves
    background = np.asarray(
        denoised.filter(ImageFilter.GaussianBlur(radius=25)), dtype=np.float32
    )

    # How much darker than its local background each (sharp) pixel is
    darkness = np.clip(background - arr, 0.0, None)

    # Steep ramp → most of a stroke is fully opaque, only true edge pixels
    # get partial alpha (natural anti-aliasing, not blur-induced softness)
    SCALE = 6.0
    alpha = np.clip(darkness * SCALE, 0, 255)
    alpha = np.where(alpha < 25, 0, alpha).astype(np.uint8)  # drop faint speckle

    out = np.zeros((*arr.shape, 4), dtype=np.uint8)
    out[..., 3] = alpha  # RGB channels stay 0 → solid black ink

    buf = io.BytesIO()
    Image.fromarray(out, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


@router.get("/{cycle_id}/signature")
async def get_signature(
    cycle_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> FileResponse:
    cycle = await db.get(ReviewCycle, cycle_id)
    if not cycle or not cycle.signature_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No signature on file")
    path = Path(cycle.signature_path)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Signature file not found")
    return FileResponse(str(path), media_type="image/png")


@router.delete(
    "/{cycle_id}/signature",
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_signature(
    cycle_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    cycle = await db.get(ReviewCycle, cycle_id)
    if not cycle:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    if cycle.signature_path:
        Path(cycle.signature_path).unlink(missing_ok=True)
        cycle.signature_path = None
        await db.commit()
