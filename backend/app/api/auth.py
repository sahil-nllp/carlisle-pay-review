"""Authentication endpoints — login (step 1), verify-otp (step 2), logout, me."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.dependencies import get_current_user
from app.core.security import sign_session, verify_password
from app.database import get_db
from app.models import AuditLog, User
from app.models.otp import EmailOTP
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    UserResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)
from app.services import email as email_service

router = APIRouter(prefix="/auth", tags=["auth"])

# Generic error to avoid leaking whether an email exists
_INVALID = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid email or password",
)
_OTP_INVALID = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired code. Please try again.",
)
_OTP_LOCKED = HTTPException(
    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
    detail="Too many incorrect attempts. Please sign in again to get a new code.",
)


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
#  Step 1 — verify credentials, send OTP
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """Verify email + password, then send a 6-digit OTP to the user's email."""
    result = await db.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash):
        raise _INVALID
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    # Invalidate any existing OTPs for this user
    await db.execute(delete(EmailOTP).where(EmailOTP.user_id == user.id))

    # Generate 6-digit code
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.otp_expiry_minutes)

    otp = EmailOTP(
        user_id=user.id,
        code_hash=_hash_code(code),
        expires_at=expires_at,
    )
    db.add(otp)
    await db.commit()

    # Send email (fire-and-forget style — if Resend is misconfigured, surface the error)
    try:
        email_service.send_otp(to_email=user.email, name=user.name.split()[0], code=code)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not send verification email: {exc}",
        ) from exc

    return LoginResponse(otp_required=True, email=user.email)


# ─────────────────────────────────────────────────────────────────────────────
#  Step 2 — verify OTP, set session cookie
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/verify-otp", response_model=VerifyOtpResponse)
async def verify_otp(
    body: VerifyOtpRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> VerifyOtpResponse:
    """Verify the 6-digit OTP and issue a session cookie on success."""
    result = await db.execute(select(User).where(User.email == body.email.lower()))
    user = result.scalar_one_or_none()
    if not user:
        raise _OTP_INVALID

    # Fetch the active (non-used, non-expired) OTP
    now = datetime.now(timezone.utc)
    otp_result = await db.execute(
        select(EmailOTP).where(
            EmailOTP.user_id == user.id,
            EmailOTP.used.is_(False),
            EmailOTP.expires_at > now,
        )
    )
    otp = otp_result.scalar_one_or_none()
    if not otp:
        raise _OTP_INVALID

    # Increment attempt counter before checking (prevents timing oracle)
    otp.attempts += 1
    if otp.attempts > settings.otp_max_attempts:
        otp.used = True
        await db.commit()
        raise _OTP_LOCKED

    # Constant-time compare via hash
    if otp.code_hash != _hash_code(body.code.strip()):
        await db.commit()
        raise _OTP_INVALID

    # Mark as used
    otp.used = True
    user.last_login_at = datetime.now(timezone.utc)
    db.add(AuditLog(user_id=user.id, action="login"))
    await db.commit()
    await db.refresh(user)

    # Issue session cookie
    token = sign_session(user.id)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_lifetime_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return VerifyOtpResponse(user=UserResponse.model_validate(user))


# ─────────────────────────────────────────────────────────────────────────────
#  Logout / me
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    db.add(AuditLog(user_id=user.id, action="logout"))
    await db.commit()
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        samesite="lax",
        secure=settings.cookie_secure,
    )


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)
