"""Downloads endpoints — Phase 5.

Routes:
  GET  /cycles/{cycle_id}/downloads          — list all generated files for a cycle
  GET  /downloads/{file_id}                  — stream a file for download
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.database import get_db
from app.models import GeneratedFile, User

router = APIRouter(tags=["downloads"])

FILE_TYPE_LABELS = {
    "letters_zip":     "Pay Letters (ZIP)",
    "ukg_upload":      "UKG Payroll Upload",
    "regional_excel":  "Regional Summary Excel",
}

MIME_TYPES = {
    "letters_zip":    "application/zip",
    "ukg_upload":     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "regional_excel": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@router.get("/cycles/{cycle_id}/downloads")
async def list_downloads(
    cycle_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """Return all generated files for a cycle, newest first."""
    stmt = (
        select(GeneratedFile)
        .where(GeneratedFile.cycle_id == cycle_id)
        .order_by(GeneratedFile.created_at.desc())
    )
    result = await db.execute(stmt)
    files = result.scalars().all()

    return [
        {
            "id": f.id,
            "site": f.site,
            "file_type": f.file_type,
            "label": FILE_TYPE_LABELS.get(f.file_type, f.file_type),
            "filename": f.filename,
            "file_size": f.file_size,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in files
    ]


@router.get("/downloads/{file_id}")
async def download_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse:
    """Stream a generated file for download."""
    gf = await db.get(GeneratedFile, file_id)
    if not gf:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")

    path = Path(gf.file_path)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File has been removed from storage")

    return FileResponse(
        path=str(path),
        filename=gf.filename,
        media_type=MIME_TYPES.get(gf.file_type, "application/octet-stream"),
    )
