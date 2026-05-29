"""FastAPI application entry point."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.cycles import router as cycles_router
from app.api.downloads import router as downloads_router
from app.api.review import router as review_router
from app.api.uploads import router as uploads_router
from app.config import settings
from app.database import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup/shutdown hooks."""
    # Verify DB connection at boot
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    debug=settings.debug,
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


# ── Routers ──────────────────────────────────────────────────────────────────
app.include_router(auth_router, prefix=settings.api_prefix)
app.include_router(cycles_router, prefix=settings.api_prefix)
app.include_router(uploads_router, prefix=settings.api_prefix)
app.include_router(review_router, prefix=settings.api_prefix)
app.include_router(downloads_router, prefix=settings.api_prefix)
app.include_router(admin_router, prefix=settings.api_prefix)


# ── Root & health endpoints ──────────────────────────────────────────────────
@app.get("/")
async def root() -> dict[str, str]:
    return {
        "app": settings.app_name,
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe — confirms the API is responding."""
    return {"status": "ok"}


@app.get("/health/db")
async def health_db() -> dict[str, str]:
    """Readiness probe — confirms DB connectivity."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok", "database": "reachable"}
