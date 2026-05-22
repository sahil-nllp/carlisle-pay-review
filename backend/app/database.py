"""Async SQLAlchemy engine, session factory, and Base class."""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# ── Engine ────────────────────────────────────────────────────────────────────
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
    future=True,
)

# ── Session factory ──────────────────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


# ── Declarative base ─────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    """Base class for all ORM models."""

    pass


# ── FastAPI dependency ───────────────────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a database session, ensuring it is closed afterward."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
