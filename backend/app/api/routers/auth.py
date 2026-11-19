from html import escape

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import uuid

from app.core.deps import get_current_user, require_impersonator
from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    create_password_reset_token,
    decode_password_reset_token,
    hash_password,
    reset_token_matches,
    verify_password,
)
from app.db.session import get_db
from app.models.user import ADMIN_ROLES, User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    PasswordChangeRequest,
    ResetPasswordRequest,
    TokenResponse,
)
from app.services.mailer import send_email

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).where(func.lower(func.trim(User.email)) == payload.email.strip().lower())
    )
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        # Deliberately distinct from "invalid credentials": the password was
        # right, the account is switched off, and saying so saves a support
        # round-trip. It leaks nothing an ex-teammate doesn't already know.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated — ask an Owner to re-enable it",
        )
    token = create_access_token(subject=str(user.id), role=user.role)
    return TokenResponse(access_token=token)


@router.post("/impersonate/{user_id}", response_model=TokenResponse)
async def impersonate_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_impersonator),
):
    """Admin-only endpoint to impersonate an account in the system.

    `require_impersonator` rather than `require_role(*ADMIN_ROLES)` so an
    admin who is *already* simulating someone can switch straight to a
    different account. Under the old dependency the request was judged by the
    role of whoever was being simulated, so switching meant stopping first —
    and every hop stayed attributed to the same real admin regardless.

    A Founder's Office cannot impersonate an Owner or a peer Founder's
    Office. Impersonation mints a working token for the target, so without
    this the whole admin-tier boundary would be one click wide: everything
    the Founder's Office may not do to an Owner account, it could do *as*
    one."""
    target_user = await db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if current_admin.role != "owner" and target_user.role in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an Owner can impersonate an owner-level account",
        )
    if not target_user.is_active:
        # The account can't log in, so a session as it is a session that
        # every request would 401 on — better to say so here.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That account is deactivated"
        )
    token = create_access_token(
        subject=str(target_user.id),
        role=target_user.role,
        # Always the real Owner, never the account just being simulated —
        # otherwise a chain of hops would rewrite who is accountable.
        impersonated_by=str(current_admin.id),
    )
    return TokenResponse(access_token=token)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: PasswordChangeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Self-service password change for an already-authenticated user, not
    account recovery. A user who's forgotten their password entirely has no
    session to call this with — that is POST /auth/forgot-password (emailed
    link) or POST /users/{id}/reset-password (Owner/HR)."""
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    await db.commit()


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Email a single-use reset link.

    Always 204, whether or not the address belongs to an account, so this
    cannot be used to find out who works here. The link carries a signed,
    short-lived token that stops working as soon as the password changes."""
    result = await db.execute(
        select(User).where(func.lower(func.trim(User.email)) == payload.email.strip().lower())
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return
    settings = get_settings()
    token = create_password_reset_token(str(user.id), user.password_hash)
    link = f"{settings.frontend_base_url.rstrip('/')}/reset-password?token={token}"
    minutes = settings.password_reset_expire_minutes
    text = (
        f"Hi {user.name},\n\n"
        "Someone asked to reset the password for your Kontent OS account. "
        f"Use this link within {minutes} minutes:\n\n{link}\n\n"
        "If this wasn't you, ignore this email — your password stays as it is."
    )
    html = (
        f"<p>Hi {escape(user.name)},</p>"
        "<p>Someone asked to reset the password for your Kontent OS account.</p>"
        f'<p><a href="{link}">Choose a new password</a> (valid for {minutes} minutes).</p>'
        "<p>If this wasn't you, ignore this email — your password stays as it is.</p>"
    )
    await send_email(user.email.strip(), "Reset your Kontent OS password", text, html)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password_with_token(
    payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)
):
    """Set a new password using the token from the emailed link."""
    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="This reset link is invalid or has expired — request a new one",
    )
    try:
        claims = decode_password_reset_token(payload.token)
        user = await db.get(User, uuid.UUID(claims["sub"]))
    except (JWTError, KeyError, ValueError):
        raise invalid
    if user is None or not user.is_active or not reset_token_matches(claims, user.password_hash):
        raise invalid
    user.password_hash = hash_password(payload.new_password)
    await db.commit()
