"""The tool registry, and the two rules that make this layer safe.

**1. Every tool runs as the calling user.** A tool body reuses the same
permission functions the REST routes use — `services/access.py`,
`core/deps.py::check_pod_lead` — and writes no scoping logic of its own. The
bot is a new client of the permission model, not a new path around it. An LLM
querying through a service account would reintroduce every hole the hardening
pass closed (docs/00-status.md) in one move, and hand out the cross-editor
comparison docs/04-permissions.md exists to prevent.

**2. A tool the caller may not use never reaches the model.** `schemas_for()`
filters by role before the request leaves the server, so the bot cannot offer
what it would then have to refuse. `run_tool()` re-checks anyway — the same
reasoning as "the frontend hiding a button is not the security boundary".

Everything a tool returns goes into the model's context, and some of it
(job titles, QC change lists) is text a user wrote. `run_tool` therefore never
raises into the agent loop: a denial comes back as a result the model can read
and explain, and the data it was denied stays where it is.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import LEAD_ROLES, User, has_role

logger = logging.getLogger(__name__)

# The lead roles only, everywhere — the Owner and TLs, counting a lent TL
# (`has_role`, not `user.role`). QCs, VEs, HR and anyone whose role grants
# nothing have no bot and no analytics — a deliberate decision, see
# docs/04-permissions.md. Scope inside a tool still differs: the Owner reads
# every pod, a TL reads the pods they lead.
DEFAULT_ROLES: tuple[str, ...] = LEAD_ROLES

ToolHandler = Callable[[AsyncSession, User, Any], Awaitable[Any]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    args_model: type[BaseModel]
    handler: ToolHandler
    allowed_roles: tuple[str, ...] = field(default=DEFAULT_ROLES)

    def json_schema(self) -> dict:
        """The OpenAI-style function definition sent to the model.

        Generated from the Pydantic model rather than hand-written, so a
        tool's declared contract and the validation it actually performs
        cannot drift apart — the same rule enum columns follow in
        `schemas/` (docs/07-backend-rules.md). Arg models stay flat and
        primitive so this stays a plain schema with no `$ref` indirection
        for the gateway to choke on.
        """
        parameters = self.args_model.model_json_schema()
        parameters.pop("title", None)
        for prop in parameters.get("properties", {}).values():
            prop.pop("title", None)
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": parameters,
            },
        }


_REGISTRY: dict[str, ToolSpec] = {}


def tool(
    *,
    name: str,
    description: str,
    args_model: type[BaseModel],
    allowed_roles: tuple[str, ...] = DEFAULT_ROLES,
):
    """Register a query function as a tool the model may call."""

    def decorate(handler: ToolHandler) -> ToolHandler:
        if name in _REGISTRY:
            raise RuntimeError(f"duplicate tool name: {name}")
        _REGISTRY[name] = ToolSpec(
            name=name,
            description=description,
            args_model=args_model,
            handler=handler,
            allowed_roles=allowed_roles,
        )
        return handler

    return decorate


def specs_for(user: User) -> list[ToolSpec]:
    return [spec for spec in _REGISTRY.values() if has_role(user, *spec.allowed_roles)]


def schemas_for(user: User) -> list[dict]:
    return [spec.json_schema() for spec in specs_for(user)]


def all_specs() -> list[ToolSpec]:
    return list(_REGISTRY.values())


async def run_tool(db: AsyncSession, user: User, *, name: str, arguments: dict) -> Any:
    """Validate, authorize, execute. Returns a result the model can read —
    including for failures, which is why nothing here raises.

    A tool that raised would abort the whole conversation on a typo'd
    argument. Handing the model a readable error instead lets it correct
    itself, which is the LLM equivalent of returning a 422 that names the
    allowed values rather than a 500.
    """
    spec = _REGISTRY.get(name)
    if spec is None:
        return {"error": f"No such tool: {name}. Use only the tools you were given."}

    if not has_role(user, *spec.allowed_roles):
        # Unreachable through `schemas_for`, which never offered it — so
        # getting here means the model invented the call. Refuse and say so.
        logger.warning("role %s attempted unoffered tool %s", user.role, name)
        return {"error": "You are not permitted to use this tool."}

    try:
        args = spec.args_model.model_validate(arguments or {})
    except ValidationError as exc:
        return {
            "error": "Invalid arguments.",
            "details": [
                {"field": ".".join(str(p) for p in e["loc"]), "problem": e["msg"]}
                for e in exc.errors()
            ],
        }

    try:
        return await spec.handler(db, user, args)
    except HTTPException as exc:
        # A real permission denial from the shared checks. The model is told
        # it was refused; it does not get the data, and it cannot retry its
        # way past this because the refusal comes from the same function
        # that guards the REST route.
        return {"error": str(exc.detail), "status": exc.status_code}
