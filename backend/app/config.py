"""Application configuration loaded from environment variables."""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed settings sourced from .env / environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Environment ───────────────────────────────────────────────────────
    environment: str = "development"
    debug: bool = True

    # ── App ───────────────────────────────────────────────────────────────
    app_name: str = "Carlisle Pay Review"
    api_prefix: str = "/api/v1"

    # ── Database ──────────────────────────────────────────────────────────
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/carlisle_payreview"
    )
    database_url_sync: str = Field(
        default="postgresql+psycopg2://postgres:postgres@localhost:5432/carlisle_payreview"
    )

    # ── Security ──────────────────────────────────────────────────────────
    secret_key: str = "change-me"
    session_cookie_name: str = "carlisle_session"
    session_lifetime_hours: int = 8

    # ── CORS ──────────────────────────────────────────────────────────────
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
