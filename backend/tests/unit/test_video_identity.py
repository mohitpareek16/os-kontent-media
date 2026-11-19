"""services/video_identity.py::canonical_video_key.

The bug this exists for: Frame.io hands out a `/project/…/view/<asset>` URL to
a signed-in reviewer and a `/share/…/view/<asset>` URL to everyone else. Both
were stored verbatim as the grouping key, so one cut showed up as two videos
and neither reviewer saw the other's notes.
"""
from __future__ import annotations

import pytest

from app.services.video_identity import canonical_video_key

pytestmark = pytest.mark.unit

# The two real URLs that were sitting in the table, same asset, two rows.
PROJECT_URL = (
    "https://next.frame.io/project/e146a03c-b6d1-414a-bcd1-982ec9af6cf4"
    "/view/28ce7744-18ab-4d44-af72-9b0a995b0b16"
)
SHARE_URL = (
    "https://next.frame.io/share/90029cd0-b3f8-4e34-a528-66a2dd15691a"
    "/view/28ce7744-18ab-4d44-af72-9b0a995b0b16"
)


def test_project_and_share_links_are_the_same_video():
    assert canonical_video_key(PROJECT_URL) == canonical_video_key(SHARE_URL)
    assert canonical_video_key(PROJECT_URL) == (
        "frameio:asset:28ce7744-18ab-4d44-af72-9b0a995b0b16"
    )


def test_different_assets_stay_apart():
    other = PROJECT_URL.replace("28ce7744", "38ce7744")
    assert canonical_video_key(other) != canonical_video_key(PROJECT_URL)


@pytest.mark.parametrize(
    "url",
    [
        PROJECT_URL + "?t=12.5",
        PROJECT_URL + "#comment-abc",
        PROJECT_URL + "/",
        PROJECT_URL.replace("next.frame.io", "NEXT.FRAME.IO"),
        PROJECT_URL.upper().replace("HTTPS://NEXT.FRAME.IO", "https://next.frame.io"),
    ],
)
def test_session_noise_does_not_split_a_video(url):
    """Timestamps, comment anchors, trailing slashes and casing all arrive on
    real links people paste to each other."""
    assert canonical_video_key(url) == canonical_video_key(PROJECT_URL)


def test_v3_review_link_keys_on_the_asset():
    v3 = (
        "https://app.frame.io/reviews/aaaaaaaa-1111-2222-3333-444444444444"
        "/28ce7744-18ab-4d44-af72-9b0a995b0b16"
    )
    assert canonical_video_key(v3) == canonical_video_key(PROJECT_URL)


def test_v3_presentation_keys_on_itself():
    url = "https://app.frame.io/presentations/aaaaaaaa-1111-2222-3333-444444444444"
    assert canonical_video_key(url) == (
        "frameio:presentation:aaaaaaaa-1111-2222-3333-444444444444"
    )


def test_unknown_host_falls_back_to_the_url():
    """An f.io short link carries no asset id — it must still group with
    itself rather than collapsing into one bucket with every other stranger."""
    assert canonical_video_key("https://f.io/abc123/") == "url:https://f.io/abc123"
    assert canonical_video_key("https://f.io/abc123") != canonical_video_key(
        "https://f.io/xyz789"
    )


def test_blank_url_does_not_explode():
    assert canonical_video_key("") == "url:"
    assert canonical_video_key(None) == "url:"  # type: ignore[arg-type]
