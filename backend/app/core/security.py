"""Password hashing + signed-session-cookie helpers.

We use bcrypt for passwords and itsdangerous URLSafeTimedSerializer for
session cookies. The cookie contains only the user ID; user data is loaded
from the DB on each request (no stale data, easy logout).
"""
from __future__ import annotations

import bcrypt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import settings

_SESSION_SALT = "carlisle-session-v1"


# ── Password hashing ─────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    """Return a bcrypt hash for the given password."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time check of password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ── Session token helpers ────────────────────────────────────────────────────
def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key, salt=_SESSION_SALT)


def sign_session(user_id: int) -> str:
    """Produce a signed, tamper-proof session token containing user_id."""
    return _serializer().dumps({"uid": user_id})


def read_session(token: str) -> int | None:
    """Verify a session token and return the user_id, or None if invalid/expired."""
    if not token:
        return None
    max_age = settings.session_lifetime_hours * 3600
    try:
        data = _serializer().loads(token, max_age=max_age)
    except (BadSignature, SignatureExpired):
        return None
    uid = data.get("uid") if isinstance(data, dict) else None
    return uid if isinstance(uid, int) else None
