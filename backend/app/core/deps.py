import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.models.user import ADMIN_ROLES, ALL_PODS_ROLES, User, has_role

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_access_token(token)
        if payload.get("purpose"):
            # A password-reset token is signed with the same key; it must
            # never double as a login session.
            raise ValueError("not an access token")
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # Checked per-request, not just at login: deactivating someone takes
    # effect immediately rather than whenever their token happens to expire
    # — same reasoning as pod membership never being baked into the token.
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deactivated")
    return user


async def require_impersonator(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """The admin behind the current session — whether or not they are already
    simulating somebody.

    Impersonation hands back a token for the *target*, so an Owner simulating
    a VE was, to every subsequent request, a VE. `require_role("owner")` then
    refused the next impersonation call, and the only way to switch to a
    different person was to stop impersonating first and start again. The
    token still carries `impersonated_by`, so the real Owner is knowable:
    that claim is what this resolves, and it is re-checked against the
    database every request, so an Owner who is demoted or deactivated
    mid-session immediately loses the power.
    """
    try:
        payload = decode_access_token(token)
        if payload.get("purpose"):
            raise ValueError("not an access token")
        admin_id = uuid.UUID(payload.get("impersonated_by") or payload["sub"])
    except (JWTError, KeyError, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    admin = await db.get(User, admin_id)
    if admin is None or not admin.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account deactivated")
    if admin.role not in ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return admin


def require_role(*roles: str):
    """Gate a route on holding any of `roles` — primary *or* secondary.

    Asked through `has_role` rather than `user.role in roles`, which is the
    single line that makes a lent TL a real one everywhere at once: every
    lead-gated route in the product reads this, so an editor who runs two
    client pods reaches the same screens a TL does, and `check_pod_lead` then
    narrows them to their own pods.
    """

    async def _check(user: User = Depends(get_current_user)) -> User:
        if not has_role(user, *roles):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
        return user

    return _check


async def require_pod_member(
    pod_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """The company-wide tier bypasses pod scoping; everyone else must be a
    member of pod_id.

    Relies on the route declaring a `{pod_id}` path parameter — FastAPI
    resolves it here the same way it resolves it in the endpoint itself.
    """
    if has_role(user, *ALL_PODS_ROLES):
        return user
    result = await db.execute(
        select(PodMember).where(PodMember.pod_id == pod_id, PodMember.user_id == user.id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this pod")
    return user


async def check_pod_lead(db: AsyncSession, pod_id: uuid.UUID, user: User) -> None:
    """The company-wide tier bypasses; everyone else must be the pod's own TL.
    Stricter than require_pod_member — for actions the permission matrix
    scopes to 'lead of this pod' specifically, like adding/removing pod
    members or the delivery checklist, not general pod-scoped read/write
    access. A plain function (not a Depends) so routes that only learn pod_id
    after loading their resource — e.g. /jobs/{id}/checklist — can call it
    too.

    A secondary TL passes this the same way a primary one does — the check is
    `Pod.tl_id == user.id`, and the whole point of lending the role is that
    the pods you were handed are yours (docs/04)."""
    if has_role(user, *ALL_PODS_ROLES):
        return
    pod = await db.get(Pod, pod_id)
    if pod is None or pod.tl_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not the TL of this pod")


async def require_pod_lead(
    pod_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Depends()-compatible wrapper of check_pod_lead for routes with
    `{pod_id}` in their own path, e.g. /pods/{pod_id}/members."""
    await check_pod_lead(db, pod_id, user)
    return user
