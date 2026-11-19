"""Name → id resolution.

Not a convenience: everything in this schema is keyed by uuid and everyone
asks questions by name ("how's Dhan doing", "how many rounds is Aditya
averaging"). Without this the model cannot take a first step, and the
alternative — letting it guess ids — is how you get confident answers about
the wrong client.

The lookups themselves are `services/search.py`, shared with the header's
global search box — one definition of "which pods/people/jobs can this person
name", so the bot and the UI cannot drift into disagreeing about it. That
module scopes to exactly what the caller can already reach through the REST
API: pods via `pod_scope_clauses` (same rule as `GET /pods`), people via
membership of those pods (same rule as `GET /pods/{id}/members`), jobs via
`job_scope_clauses` (same rule as `GET /jobs`). A name the caller cannot see
does not come back, so the bot cannot be used to enumerate the company.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pod import Pod
from app.models.pod_member import PodMember
from app.models.user import ALL_PODS_ROLES, User, has_role
from app.services.ai.tools.base import tool
from app.services.search import search_jobs, search_people, search_pods, visible_pod_ids

MAX_MATCHES = 10


class ResolveEntityArgs(BaseModel):
    query: str = Field(
        min_length=1,
        max_length=120,
        description="Part of a client/pod name, a person's name, or a job code or title.",
    )
    kind: Literal["pod", "person", "job", "any"] = Field(
        default="any",
        description="Narrow the search when you already know what you're looking for.",
    )


@tool(
    name="resolve_entity",
    description=(
        "Look up the id of a client pod, a person, or a job from part of its name or "
        "code. Call this FIRST whenever the user names something — every other tool "
        "takes ids, never names. Returns only entities you are allowed to see."
    ),
    args_model=ResolveEntityArgs,
)
async def resolve_entity(db: AsyncSession, user: User, args: ResolveEntityArgs) -> dict:
    out: dict = {"query": args.query}

    if args.kind in ("pod", "any"):
        out["pods"] = [
            {
                "pod_id": str(pod.id),
                "name": pod.name,
                "status": pod.status,
                # A TL is a member of pods they don't lead. Analytics tools
                # will refuse those, so say so up front rather than letting
                # the model discover it by being denied.
                "you_lead_this_pod": has_role(user, *ALL_PODS_ROLES) or pod.tl_id == user.id,
            }
            # `search_pods` also returns the TL's name and two counts for the
            # header's dropdown. The model has dedicated tools for both, and
            # feeding it numbers it did not ask for is how it starts quoting
            # them as answers, so they are dropped here.
            for pod, _tl_name, _open_jobs, _channels in await search_pods(
                db, user, query=args.query, limit=MAX_MATCHES
            )
        ]

    if args.kind in ("person", "any"):
        # People are visible through shared pod membership, which is what
        # `GET /pods/{id}/members` already exposes to any member.
        visible_pods = visible_pod_ids(user)
        people = []
        # The pod names `search_people` returns are a flat list; this tool
        # wants the pod *role* alongside each, which is a second query — kept
        # rather than collapsed, because "Ravi is the QC on Dhan, not the
        # editor" is exactly the distinction the model gets wrong without it.
        for person, _pod_names, _open_jobs in await search_people(
            db, user, query=args.query, limit=MAX_MATCHES
        ):
            pods_result = await db.execute(
                select(Pod.name, PodMember.pod_role)
                .join(PodMember, PodMember.pod_id == Pod.id)
                .where(PodMember.user_id == person.id, Pod.id.in_(visible_pods))
                .order_by(Pod.name)
            )
            people.append(
                {
                    "user_id": str(person.id),
                    "name": person.name,
                    "role": person.role,
                    "is_active": person.is_active,
                    "pods": [{"name": name, "pod_role": pod_role} for name, pod_role in pods_result.all()],
                }
            )
        out["people"] = people

    if args.kind in ("job", "any"):
        out["jobs"] = [
            {
                "job_id": str(job.id),
                "code": job.code,
                "title": job.title,
                "stage": job.stage,
                "pod_name": pod_name,
                "channel_name": channel_name,
                "editor_name": editor_name,
                # Why this job came back for a query that may be nowhere in
                # its own title — the model needs it for the same reason the
                # dropdown does, or it reports a Dhan job as a title match.
                "matched_on": matched_on,
            }
            for job, pod_name, channel_name, editor_name, matched_on in await search_jobs(
                db, user, query=args.query, limit=MAX_MATCHES
            )
        ]

    if not any(out.get(key) for key in ("pods", "people", "jobs")):
        out["note"] = (
            "Nothing matched. Either the name is spelled differently, or it is "
            "outside what this user is allowed to see. Do not guess an id."
        )
    return out
