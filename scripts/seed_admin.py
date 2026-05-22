"""Seed the first HR admin user.

Run from the backend folder with the venv active:

    python ../scripts/seed_admin.py

Or override defaults via env vars:

    SEED_EMAIL=mack@nllp.com.au SEED_NAME="Mack" SEED_PASSWORD="..." \
        python ../scripts/seed_admin.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Allow running from project root: add backend/ to sys.path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import select  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.database import AsyncSessionLocal  # noqa: E402
from app.models import User, UserRole  # noqa: E402


DEFAULT_EMAIL = os.getenv("SEED_EMAIL", "admin@carlislehealth.com.au")
DEFAULT_NAME = os.getenv("SEED_NAME", "HR Admin")
DEFAULT_PASSWORD = os.getenv("SEED_PASSWORD", "admin123")


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        existing = await db.execute(select(User).where(User.email == DEFAULT_EMAIL))
        if existing.scalar_one_or_none():
            print(f"User already exists: {DEFAULT_EMAIL} — skipping")
            return

        user = User(
            email=DEFAULT_EMAIL.lower(),
            name=DEFAULT_NAME,
            password_hash=hash_password(DEFAULT_PASSWORD),
            role=UserRole.HR_ADMIN.value,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        print("-" * 50)
        print("  HR Admin user created")
        print(f"    Email:    {DEFAULT_EMAIL}")
        print(f"    Password: {DEFAULT_PASSWORD}")
        print(f"    Role:     {UserRole.HR_ADMIN.value}")
        print("-" * 50)


if __name__ == "__main__":
    asyncio.run(seed())
