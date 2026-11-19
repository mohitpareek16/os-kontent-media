"""Canonical identity for a review video, derived from its URL.

Frame.io serves the same asset under different URLs depending on how the
reviewer got there — signed in they land on `/project/<project>/view/<asset>`,
through a share link on `/share/<share>/view/<asset>`. Both carry the same
asset id, but grouping notes on the raw URL split them into two videos, so two
people reviewing the same cut could not see each other's notes.

The key is derived here, from the URL the extension already sends, rather than
being sent by the extension: builds in the wild keep working without an update,
and a client cannot decide which video's notes it gets to read.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

# Frame.io V4 — `/project/<id>/view/<asset>` and `/share/<id>/view/<asset>`.
# Only the trailing segment identifies the asset; everything before it says
# how you arrived, which is exactly what we want to discard.
_V4_VIEW = re.compile(r"/view/([0-9a-f-]{16,})", re.I)

# Frame.io V3 — `/reviews/<review>/<asset>`, occasionally with a trailing
# `/comment/<id>` when someone copies a deep link out of the comment sidebar.
_V3_REVIEW = re.compile(r"/reviews?/[0-9a-f-]{16,}/([0-9a-f-]{16,})", re.I)

# Frame.io V3 presentation pages have no separate asset id in the path.
_V3_PRESENTATION = re.compile(r"/presentations?/([0-9a-f-]{16,})", re.I)


def canonical_video_key(url: str) -> str:
    """Return a stable key identifying the video `url` points at.

    Two URLs for the same Frame.io asset return the same key. Anything we
    don't recognise falls back to the normalised URL, so an unknown host still
    groups with itself instead of collapsing everything into one bucket.
    """
    raw = (url or "").strip()
    if not raw:
        return "url:"

    parts = urlsplit(raw)
    # Query and fragment are session noise on every shape we've seen —
    # `?t=12`, tracking params, `#comment-…`.
    path = parts.path

    for pattern, kind in (
        (_V4_VIEW, "asset"),
        (_V3_REVIEW, "asset"),
        (_V3_PRESENTATION, "presentation"),
    ):
        match = pattern.search(path)
        if match:
            return f"frameio:{kind}:{match.group(1).lower()}"

    host = parts.netloc.lower()
    normalised_path = path.rstrip("/")
    scheme = parts.scheme.lower() or "https"
    return f"url:{scheme}://{host}{normalised_path}"
