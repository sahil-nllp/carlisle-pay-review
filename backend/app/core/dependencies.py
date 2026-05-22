"""FastAPI dependencies — current user resolution and role guards."""
from collections.abc import Iterable

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import read_session
from app.database import get_db
from app.models import User


async def get_current_user(
    session_token: str | None = Cookie(default=None, alias=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the logged-in user from the session cookie.

    Reads the configured cookie name dynamically so tests can override it.
    """
    # Read the cookie value via the configured name.
    # Cookie(alias=...) only accepts a literal, so we re-read from FastAPI's
    # request scope by using a wrapper below.
    raise NotImplementedError  # pragma: no cover  — replaced below


def _make_get_current_user():
    """Build a get_current_user dependency that reads the configured cookie name."""
    cookie_name = settings.session_cookie_name

    async def _dep(
        session_token: str | None = Cookie(default=None, alias=cookie_name),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if not session_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
            )
        user_id = read_session(session_token)
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session",
            )
        user = await db.get(User, user_id)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )
        return user

    return _dep


# Public dependency — use this in routes
get_current_user = _make_get_current_user()


def require_roles(*allowed: str):
    """Dependency factory: require the current user to have one of the given roles."""
    allowed_set = set(allowed)

    async def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(sorted(allowed_set))}",
            )
        return user

    return _dep


def require_any_role(roles: Iterable[str]):
    """Same as require_roles but takes an iterable rather than varargs."""
    return require_roles(*roles)
