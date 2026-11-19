from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str, role: str, impersonated_by: str | None = None) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "role": role, "exp": expire}
    if impersonated_by:
        payload["impersonated_by"] = impersonated_by
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


PASSWORD_RESET_PURPOSE = "password_reset"


def _reset_fingerprint(password_hash: str) -> str:
    """A short digest of the current password hash. Baked into the reset token
    so it dies the moment the password changes — a reset link is single-use
    without needing a table to track it."""
    import hashlib

    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


def create_password_reset_token(user_id: str, password_hash: str) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_expire_minutes)
    payload = {
        "sub": user_id,
        "purpose": PASSWORD_RESET_PURPOSE,
        "fp": _reset_fingerprint(password_hash),
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_password_reset_token(token: str) -> dict:
    """Raises JWTError for anything that is not a live reset token — including
    a normal access token, which carries no `purpose`."""
    payload = decode_access_token(token)
    if payload.get("purpose") != PASSWORD_RESET_PURPOSE:
        raise JWTError("not a password reset token")
    return payload


def reset_token_matches(payload: dict, password_hash: str) -> bool:
    return payload.get("fp") == _reset_fingerprint(password_hash)
