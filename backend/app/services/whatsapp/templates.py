"""Submitting templates to Meta, and keeping the local copy honest.

Two directions, and they are not symmetrical.

**Out:** `submit` posts a registry definition to Meta and stamps the mirror
row with the hash of what was sent. Nothing else ever writes `registry_hash` —
that is what makes it mean "this is the version Meta reviewed" rather than
"this is the version in the source tree".

**In:** `sync` reads every template on the account back and overwrites status,
category, quality and rejection reason. It does *not* overwrite `components`
or `registry_hash`, because those record what we submitted; Meta returns its
own normalised form, and letting it win would erase the drift signal at the
exact moment it became useful.

The status webhook does the same job faster for one template. Sync exists
because webhooks get missed — a redeploy mid-review, a 500 on our side, a
subscription that quietly lapsed — and after any of those the only way back to
the truth is to ask. It is also the first thing a fresh deployment runs, where
there are no webhooks to have missed.

**Drift, and why it is ours alone to detect.** If the body changes in code and
the template is not resubmitted, Meta sees nothing wrong: its copy is approved
and unchanged. The next send then fills the new parameter list into the old
approved body and comes back 132000. Comparing `registry_hash` against the
current `spec.hash()` is the only place that is visible before it happens.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.whatsapp import WhatsAppTemplate
from app.services.whatsapp import registry
from app.services.whatsapp.client import GraphClient, MetaError

logger = logging.getLogger("app.whatsapp")

# Fields worth asking Meta for. Requesting them explicitly rather than taking
# the default projection: the default has changed shape before, and a field
# that silently stops arriving would read here as "the value became null".
SYNC_FIELDS = (
    "id,name,language,status,category,components,quality_score,rejected_reason"
)
# Meta pages this endpoint. 200 is its documented ceiling per page and far more
# templates than this application will ever define, but the loop below follows
# `paging.next` anyway — an account can also hold templates created by hand.
SYNC_PAGE_SIZE = 200


async def get_row(
    db: AsyncSession, name: str, language: str
) -> WhatsAppTemplate | None:
    return (
        await db.execute(
            select(WhatsAppTemplate).where(
                WhatsAppTemplate.name == name, WhatsAppTemplate.language == language
            )
        )
    ).scalar_one_or_none()


async def submit(db: AsyncSession, *, name: str) -> WhatsAppTemplate:
    """Create the template at Meta and record what was sent.

    Raises `MetaError` on refusal — the admin route turns that into a 400 with
    Meta's own words, which are usually specific enough to act on ("body text
    cannot end with a variable").
    """
    spec = registry.get(name)
    if spec is None:
        raise KeyError(f"No template named {name!r} in the registry")
    registry.validate(spec)

    settings = get_settings()
    client = GraphClient()
    body = {
        "name": spec.name,
        "language": spec.language,
        "category": spec.category,
        "components": spec.components(),
    }
    result = await client.post(
        f"{settings.whatsapp_business_account_id}/message_templates", body
    )

    now = datetime.now(timezone.utc)
    row = await get_row(db, spec.name, spec.language)
    if row is None:
        row = WhatsAppTemplate(name=spec.name, language=spec.language)
        db.add(row)
    row.meta_template_id = result.get("id") or row.meta_template_id
    # Meta echoes the category it actually filed the template under, which is
    # not always the one asked for — it re-categorises at creation time as well
    # as after approval. Taking its word here rather than assuming ours means
    # the drift shows up immediately instead of at the first send.
    row.category = result.get("category") or spec.category
    row.requested_category = spec.category
    row.status = result.get("status") or "PENDING"
    row.components = {"components": spec.components()}
    row.registry_hash = spec.hash()
    row.rejected_reason = None
    row.submitted_at = now
    row.last_status_at = now
    row.last_synced_at = now
    if row.status == "APPROVED":
        row.approved_at = now
    await db.flush()
    return row


async def resubmit(db: AsyncSession, *, name: str) -> WhatsAppTemplate:
    """Push the current definition at an existing template.

    Meta allows editing an APPROVED or REJECTED template's components — but not
    its name, language, or (once approved) its category. A change that needs
    any of those is a new template and a new `_vN` suffix, which is why the
    registry names carry one.

    A template that does not exist at Meta yet falls through to `submit`: the
    admin page offers one button for "make Meta's copy match the code" and
    which underlying call that is, is not the operator's problem.
    """
    spec = registry.get(name)
    if spec is None:
        raise KeyError(f"No template named {name!r} in the registry")
    registry.validate(spec)

    row = await get_row(db, spec.name, spec.language)
    if row is None or not row.meta_template_id:
        return await submit(db, name=name)

    client = GraphClient()
    # Editing posts to the template's own id, and carries components only.
    body: dict = {"components": spec.components()}
    if row.status == "REJECTED":
        # A rejected template has never been approved, so its category is
        # still ours to set — and a rejection for the wrong category is one of
        # the commoner ones.
        body["category"] = spec.category
    await client.post(row.meta_template_id, body)

    now = datetime.now(timezone.utc)
    row.components = {"components": spec.components()}
    row.registry_hash = spec.hash()
    row.requested_category = spec.category
    # An edit puts the template back into review. Saying so locally rather than
    # waiting for the webhook keeps the sender from firing at a template whose
    # approved body has just been replaced.
    row.status = "PENDING"
    row.rejected_reason = None
    row.submitted_at = now
    row.last_status_at = now
    await db.flush()
    return row


async def delete(db: AsyncSession, *, name: str, language: str) -> None:
    """Remove a template at Meta and locally.

    Meta deletes by *name*, which removes every language of it at once — the
    API takes no language parameter on this call. The local rows for that name
    go with it, rather than leaving behind a mirror of something that no longer
    exists for a sender to consult.
    """
    settings = get_settings()
    row = await get_row(db, name, language)
    client = GraphClient()
    try:
        await client.delete(
            f"{settings.whatsapp_business_account_id}/message_templates",
            {"name": name},
        )
    except MetaError as exc:
        # 100 here is usually "no such template", which is the state the caller
        # wanted. Anything else is real and goes back up.
        if exc.code != 100:
            raise
    if row is not None:
        await db.delete(row)
    await db.flush()


async def sync(db: AsyncSession) -> dict:
    """Read every template on the account back into the mirror.

    Returns a small summary for the admin page: how many were seen, how many
    rows changed, and which names Meta knows about that the registry does not.
    """
    settings = get_settings()
    client = GraphClient()
    path = f"{settings.whatsapp_business_account_id}/message_templates"
    params: dict = {"fields": SYNC_FIELDS, "limit": SYNC_PAGE_SIZE}

    seen = 0
    changed = 0
    unmanaged: list[str] = []
    now = datetime.now(timezone.utc)

    while True:
        result = await client.get(path, params)
        for item in result.get("data", []):
            seen += 1
            name = item.get("name")
            language = item.get("language") or settings.whatsapp_default_language
            if not name:
                continue
            if registry.get(name) is None:
                # Created in Meta's own UI, or left over from an older version
                # of this file. Recorded so the admin page can show it as
                # unmanaged; never sent, because nothing here knows how to fill
                # it.
                unmanaged.append(name)
            if await _apply_remote(db, item, name=name, language=language, now=now):
                changed += 1

        paging_next = (result.get("paging") or {}).get("next")
        if not paging_next:
            break
        # Meta's `next` is a fully-formed URL including the access token. It is
        # not followed directly — that would mean a second code path that
        # builds requests and handles the token, which is exactly what
        # `client.py` exists to prevent. The cursor is enough.
        after = ((result.get("paging") or {}).get("cursors") or {}).get("after")
        if not after:
            break
        params = {**params, "after": after}

    await db.flush()
    return {
        "seen": seen,
        "changed": changed,
        "unmanaged": sorted(set(unmanaged)),
        "synced_at": now,
    }


async def _apply_remote(
    db: AsyncSession, item: dict, *, name: str, language: str, now: datetime
) -> bool:
    """Write Meta's view onto one mirror row. True if anything actually moved."""
    row = await get_row(db, name, language)
    if row is None:
        row = WhatsAppTemplate(name=name, language=language)
        # A template that exists at Meta and has no local row has never been
        # submitted from here. Its requested category is unknowable, so it is
        # seeded from what Meta currently says — which makes `category_drifted`
        # False until we submit it ourselves and have something to compare.
        row.requested_category = item.get("category") or "UTILITY"
        db.add(row)

    before = (row.status, row.category, row.quality_score, row.rejected_reason)
    row.meta_template_id = item.get("id") or row.meta_template_id
    row.status = item.get("status") or row.status
    row.category = item.get("category") or row.category
    quality = item.get("quality_score")
    if isinstance(quality, dict):
        # Meta returns either a bare string or {"score": "GREEN", ...}
        # depending on the endpoint and the version.
        quality = quality.get("score")
    row.quality_score = quality or row.quality_score
    row.rejected_reason = item.get("rejected_reason") or None
    row.last_synced_at = now
    if row.status == "APPROVED" and row.approved_at is None:
        row.approved_at = now

    after = (row.status, row.category, row.quality_score, row.rejected_reason)
    if before != after:
        row.last_status_at = now
        if row.category_drifted and before[1] != row.category:
            # The webhook logs this too (`inbound._apply_template_category`),
            # and that is the fast path. This is the one that catches it when
            # the webhook was missed — a redeploy mid-review, a 500, a lapsed
            # subscription — which is the whole reason a reconcile exists. A
            # UTILITY template re-filed as MARKETING is capped at roughly two
            # messages per person per day and fails silently otherwise.
            logger.warning(
                "WhatsApp template %s is filed as %s at Meta, not the %s we asked for",
                row.name,
                row.category,
                row.requested_category,
            )
        return True
    return False


def drift_for(row: WhatsAppTemplate | None, spec: registry.TemplateSpec) -> bool:
    """Has the code moved since Meta approved this?

    A row that has never been submitted is not drifted — it is missing, which
    the admin page says differently because the fix is different.
    """
    if row is None or row.registry_hash is None:
        return False
    return row.registry_hash != spec.hash()
