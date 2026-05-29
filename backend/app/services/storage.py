"""File storage helpers.

Local filesystem implementation. Designed so the public surface can be
re-implemented as S3 / Azure Blob later without changing callers.
"""
from __future__ import annotations

import shutil
from pathlib import Path
from uuid import uuid4

STORAGE_ROOT = Path(__file__).resolve().parent.parent.parent / "storage"


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def uploads_dir(cycle_id: int) -> Path:
    return _ensure_dir(STORAGE_ROOT / "uploads" / str(cycle_id))


def outputs_dir(cycle_id: int, site: str) -> Path:
    """Generated output files (letters, UKG upload, regional Excel) per site."""
    safe_site = "".join(c if c.isalnum() or c in "._- " else "_" for c in site)
    return _ensure_dir(STORAGE_ROOT / "outputs" / str(cycle_id) / safe_site)


def staging_dir() -> Path:
    """Holds uploads that haven't been committed to a cycle yet."""
    return _ensure_dir(STORAGE_ROOT / "staging")


def save_to_staging(filename: str, data: bytes) -> Path:
    """Save bytes to a staging file. Returns the absolute path."""
    safe_name = _safe_filename(filename)
    path = staging_dir() / f"{uuid4().hex}_{safe_name}"
    path.write_bytes(data)
    return path


def new_staging_session() -> tuple[str, Path]:
    """Create a fresh staging session dir for a multi-file upload.

    Returns (staging_id, path_to_dir).
    """
    sid = uuid4().hex
    path = _ensure_dir(staging_dir() / sid)
    return sid, path


def staging_session_path(staging_id: str) -> Path:
    """Return the dir for a given staging session (may not exist)."""
    return staging_dir() / staging_id


def save_to_session(session_dir: Path, filename: str, data: bytes) -> Path:
    """Save a named file into a staging session dir."""
    safe = _safe_filename(filename)
    path = session_dir / safe
    path.write_bytes(data)
    return path


def cleanup_staging_session(staging_id: str) -> None:
    """Remove a whole staging session dir + all files in it."""
    p = staging_session_path(staging_id)
    if p.exists():
        try:
            shutil.rmtree(p)
        except OSError:
            pass


def move_to_cycle(staging_path: Path, cycle_id: int, filename: str) -> Path:
    """Move a staged upload into a cycle's permanent location."""
    safe = _safe_filename(filename)
    dest = uploads_dir(cycle_id) / safe
    shutil.move(str(staging_path), str(dest))
    return dest


def cleanup_staging(staging_path: Path) -> None:
    """Discard a staged upload (e.g. user cancelled)."""
    if staging_path.exists():
        try:
            staging_path.unlink()
        except OSError:
            pass


def _safe_filename(name: str) -> str:
    """Strip path separators and dodgy chars from a filename."""
    name = name.replace("\\", "/").split("/")[-1]
    safe = "".join(c if c.isalnum() or c in "._- " else "_" for c in name)
    return safe[:200] or "file"
