"""Admin endpoints (Phase 6) — HR Admin only.

Routes:
  GET    /admin/users              — list all users
  POST   /admin/users              — create a user
  PATCH  /admin/users/{user_id}    — update role / site / name / active / password
  GET    /admin/audit              — paginated audit log
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

import shutil

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, require_roles
from app.core.security import hash_password
from app.database import get_db
from app.models import Approval, AuditLog, Employee, GeneratedFile, ReviewCycle, User, UserRole
from app.services import storage

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles(UserRole.HR_ADMIN.value))],
)

# ─────────────────────────────────────────────────────────────────────────────
#  Schemas
# ─────────────────────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    site: str | None
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    role: Literal["hr_admin", "regional_manager", "senior_management", "payroll"]
    site: str | None = None


class PatchUserRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    role: Literal["hr_admin", "regional_manager", "senior_management", "payroll"] | None = None
    site: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=200)


class AuditEntryOut(BaseModel):
    id: int
    timestamp: datetime
    user_id: int | None
    user_name: str | None
    user_email: str | None
    action: str
    entity_type: str | None
    entity_id: int | None
    detail: dict | None


class AuditPageOut(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[AuditEntryOut]


class ClearDataResponse(BaseModel):
    cycles_deleted: int
    employees_deleted: int
    approvals_deleted: int
    files_deleted: int
    storage_cleared: bool


# ─────────────────────────────────────────────────────────────────────────────
#  Users
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
) -> list[UserOut]:
    result = await db.execute(select(User).order_by(User.name))
    return [UserOut.model_validate(u) for u in result.scalars().all()]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: CreateUserRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> UserOut:
    # Check email uniqueness
    existing = await db.execute(
        select(User).where(func.lower(User.email) == body.email.lower())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already in use")

    user = User(
        email=body.email.lower(),
        name=body.name,
        password_hash=hash_password(body.password),
        role=body.role,
        site=body.site or None,
        is_active=True,
    )
    db.add(user)
    await db.flush()  # get id before audit log

    db.add(AuditLog(
        user_id=actor.id,
        action="create_user",
        entity_type="user",
        entity_id=user.id,
        detail={"email": body.email, "role": body.role},
    ))
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserOut)
async def patch_user(
    user_id: int,
    body: PatchUserRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> UserOut:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    # Prevent de-activating yourself
    if body.is_active is False and user.id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot deactivate your own account")

    changed: dict = {}
    if body.name is not None:
        user.name = body.name
        changed["name"] = body.name
    if body.role is not None:
        user.role = body.role
        changed["role"] = body.role
    if body.site is not None:
        user.site = body.site or None
        changed["site"] = user.site
    if body.is_active is not None:
        user.is_active = body.is_active
        changed["is_active"] = body.is_active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
        changed["password"] = "(reset)"

    if changed:
        db.add(AuditLog(
            user_id=actor.id,
            action="update_user",
            entity_type="user",
            entity_id=user.id,
            detail=changed,
        ))
        await db.commit()
        await db.refresh(user)

    return UserOut.model_validate(user)


# ─────────────────────────────────────────────────────────────────────────────
#  Audit log
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/audit", response_model=AuditPageOut)
async def list_audit(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> AuditPageOut:
    offset = (page - 1) * page_size

    total_result = await db.execute(select(func.count(AuditLog.id)))
    total = total_result.scalar_one()

    logs_result = await db.execute(
        select(AuditLog)
        .order_by(AuditLog.timestamp.desc())
        .offset(offset)
        .limit(page_size)
    )
    logs = logs_result.scalars().all()

    # Resolve user info in one query
    user_ids = {log.user_id for log in logs if log.user_id is not None}
    user_map: dict[int, User] = {}
    if user_ids:
        u_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        for u in u_result.scalars():
            user_map[u.id] = u

    items = []
    for log in logs:
        u = user_map.get(log.user_id) if log.user_id else None
        items.append(AuditEntryOut(
            id=log.id,
            timestamp=log.timestamp,
            user_id=log.user_id,
            user_name=u.name if u else None,
            user_email=u.email if u else None,
            action=log.action,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            detail=log.detail,
        ))

    return AuditPageOut(total=total, page=page, page_size=page_size, items=items)


# ─────────────────────────────────────────────────────────────────────────────
#  Clear all cycle data (HR Admin only — irreversible)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/clear-data", response_model=ClearDataResponse)
async def clear_all_data(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> ClearDataResponse:
    """Delete all review cycles, employees, approvals and generated files.

    Preserved: users, alembic_version, audit_log.
    Also wipes the uploads/ and outputs/ storage directories.
    """
    # Count before deleting so we can report back
    files_count = (await db.execute(select(func.count(GeneratedFile.id)))).scalar_one()
    approvals_count = (await db.execute(select(func.count(Approval.id)))).scalar_one()
    employees_count = (await db.execute(select(func.count(Employee.id)))).scalar_one()
    cycles_count = (await db.execute(select(func.count(ReviewCycle.id)))).scalar_one()

    # Delete in FK-safe order (children before parents)
    await db.execute(delete(GeneratedFile))
    await db.execute(delete(Approval))
    await db.execute(delete(Employee))
    await db.execute(delete(ReviewCycle))

    # Audit log entry (before commit so it lands in the same transaction)
    db.add(AuditLog(
        user_id=actor.id,
        action="clear_all_data",
        entity_type="system",
        entity_id=None,
        detail={
            "cycles": cycles_count,
            "employees": employees_count,
            "approvals": approvals_count,
            "files": files_count,
        },
    ))
    await db.commit()

    # Wipe storage directories (best-effort — never fails the response)
    storage_cleared = False
    try:
        uploads = storage.STORAGE_ROOT / "uploads"
        outputs = storage.STORAGE_ROOT / "outputs"
        if uploads.exists():
            shutil.rmtree(uploads)
        if outputs.exists():
            shutil.rmtree(outputs)
        storage_cleared = True
    except Exception as exc:  # pragma: no cover
        print(f"[clear-data] storage wipe failed: {exc}")

    return ClearDataResponse(
        cycles_deleted=cycles_count,
        employees_deleted=employees_count,
        approvals_deleted=approvals_count,
        files_deleted=files_count,
        storage_cleared=storage_cleared,
    )
