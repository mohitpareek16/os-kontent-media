"""Every template this application can send, defined once, in code.

**Why not a form in the admin page.** The obvious build is a screen where you
type a template and press submit. It is the wrong one. A template is only half
a feature — the other half is the code that fills its parameters — and a
template typed into a UI has no way to stay in step with that code. The failure
is not a validation error at save time; it is error 132000 four days later, on a
real hand-off, in production, silently, because Meta counts the `{{n}}` in the
approved body and we sent a different number of them.

So the shape lives here, next to the function that fills it, and the admin page
*submits* these rather than authoring new ones. `registry_hash` is stamped onto
the mirror row at submit time, and a mismatch between that and the current
definition is the "drift" column on the Templates tab — the one failure mode
Meta's own API cannot reveal, because from Meta's side nothing is wrong.

**What Meta requires of a template body**, learned the hard way and enforced by
`validate()` below:

- it may not begin or end with a parameter;
- two parameters may not sit adjacent (`{{1}} {{2}}` is fine, `{{1}}{{2}}` is
  not);
- parameters must be numbered from 1 with no gaps;
- every parameter needs an example value at submission, or the template is
  rejected for "missing sample content" — which is the single most common
  first-submission rejection;
- a parameter's own value may not contain a newline or a run of four spaces
  (error 132007 at send time, not at submission).

These templates carry no quick-reply actions. All job actions stay in
Kontent OS. The `_v2` names keep them separate from previously approved
interactive templates.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Callable

from app.models.whatsapp import CATEGORY_UTILITY

# The recipient roles a template can be addressed to, used only for display on
# the admin page — the actual recipient is resolved per event by
# `services/whatsapp/events.py`, from the same `_STAGE_RECIPIENT` table the
# in-app notification uses. Two sources for "who gets this" would be two
# answers, and the in-app one is the one that has been right for a year.
RECIPIENT_LABELS = {
    "editor": "Assigned editor",
    "tl": "Pod TL",
    "qc": "QC2 reviewer",
    "holders": "Everyone holding the job",
    "any": "Any recipient",
}


@dataclass(frozen=True)
class Button:
    """Legacy quick reply shape, retained for reading historical messages."""

    text: str
    action: str


@dataclass(frozen=True)
class TemplateSpec:
    name: str
    #: The body, with `{{1}}`-style parameters.
    body: str
    #: One example value per parameter, in order. Required by Meta at review.
    examples: list[str]
    #: Plain text, no parameters — Meta allows parameters here but a header
    #: that varies is a header that can be rejected for a reason the body
    #: already covers.
    header: str | None = None
    footer: str | None = "Kontent OS"
    buttons: tuple[Button, ...] = ()
    language: str = "en"
    category: str = CATEGORY_UTILITY
    #: Who this is for, for the admin page only.
    recipient: str = "any"
    #: One line on the Templates tab explaining when it fires.
    purpose: str = ""
    #: Turns the event context into the parameter list, in order.
    params: Callable[[dict], list[str]] = field(default=lambda ctx: [])

    def param_count(self) -> int:
        return len(_placeholders(self.body))

    def components(self) -> list[dict]:
        """The exact JSON submitted to Meta, and stored on the mirror row."""
        components: list[dict] = []
        if self.header:
            components.append({"type": "HEADER", "format": "TEXT", "text": self.header})
        body: dict = {"type": "BODY", "text": self.body}
        if self.examples:
            # Meta's shape here is a list of lists — one list per example set,
            # and one is all that is ever needed or accepted for a body.
            body["example"] = {"body_text": [list(self.examples)]}
        components.append(body)
        if self.footer:
            components.append({"type": "FOOTER", "text": self.footer})
        if self.buttons:
            components.append(
                {
                    "type": "BUTTONS",
                    "buttons": [
                        {"type": "QUICK_REPLY", "text": b.text} for b in self.buttons
                    ],
                }
            )
        return components

    def hash(self) -> str:
        """Fingerprint of everything Meta reviews.

        Covers the components and the category, so a reworded body, a new
        button or a category change all register as drift. Does not cover
        `params` or `purpose`: those are ours, they never reach Meta, and a
        comment edit should not light up a warning that means "resubmit".
        """
        payload = json.dumps(
            {"components": self.components(), "category": self.category},
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _placeholders(text: str) -> list[int]:
    return [int(n) for n in re.findall(r"\{\{(\d+)\}\}", text)]


class TemplateInvalid(Exception):
    """A template in this file breaks one of Meta's rules.

    Raised at import-adjacent validation time rather than at submit time, and
    covered by a unit test that walks the whole registry, so the failure lands
    on whoever wrote the template rather than on whoever presses Submit a week
    later.
    """


def validate(spec: TemplateSpec) -> None:
    """Meta's structural rules, checked before anything is submitted."""
    numbers = _placeholders(spec.body)
    if numbers:
        expected = list(range(1, len(numbers) + 1))
        if sorted(numbers) != expected:
            raise TemplateInvalid(
                f"{spec.name}: parameters must be numbered 1..n with no gaps, got {numbers}"
            )
    if len(spec.examples) != len(numbers):
        raise TemplateInvalid(
            f"{spec.name}: {len(numbers)} parameters but {len(spec.examples)} examples — "
            "Meta rejects a template whose sample values are missing"
        )
    stripped = spec.body.strip()
    if re.match(r"^\{\{\d+\}\}", stripped) or re.search(r"\{\{\d+\}\}$", stripped):
        raise TemplateInvalid(f"{spec.name}: a body may not begin or end with a parameter")
    if re.search(r"\}\}\{\{", spec.body):
        raise TemplateInvalid(f"{spec.name}: two parameters may not sit adjacent")
    if len(spec.body) > 1024:
        raise TemplateInvalid(f"{spec.name}: body exceeds WhatsApp's 1024-character limit")
    if spec.footer and len(spec.footer) > 60:
        raise TemplateInvalid(f"{spec.name}: footer exceeds 60 characters")
    if spec.buttons:
        raise TemplateInvalid(f"{spec.name}: WhatsApp templates must not have buttons")


def clean_param(value: object) -> str:
    """Make one value safe to put in a template parameter.

    Newlines and runs of four or more spaces are rejected by Meta at send time
    with error 132007 — not at submission, so an un-cleaned job title with a
    line break in it is a message that fails only for the job that has one.
    Empty strings are also refused by the API, hence the dash.
    """
    text = " ".join(str(value if value is not None else "").split())
    return text if text else "—"


# --------------------------------------------------------------------------
# The ten requested notification templates.
# --------------------------------------------------------------------------

TEMPLATES: dict[str, TemplateSpec] = {}


def _register(spec: TemplateSpec) -> TemplateSpec:
    validate(spec)
    TEMPLATES[spec.name] = spec
    return spec


# Only the requested notification messages are registered. Each link opens the
# job in Kontent OS; WhatsApp replies never change job state.

def _message(name, header, body, examples, keys, recipient, purpose):
    _register(TemplateSpec(
        name=name, header=header, body=body, examples=examples,
        buttons=(), recipient=recipient, purpose=purpose,
        params=lambda c: [clean_param(c.get(key)) for key in keys],
    ))


_message(
    "video_assigned_v2", "New Video Assigned",
    "Hey {{1}}, you've received a new video job.\n"
    "Video: {{2}}\nClient: {{3}}\nDeadline: {{4}}\n"
    "Open Kontent OS to view the complete brief and start working. "
    "Make all job updates there.",
    ["Farah", "Diwali campaign teaser", "Dhan", "24 Sep"],
    ["recipient_name", "job_title", "pod_name", "deadline"],
    "editor", "TL assigned a briefed video to an editor.",
)
_message(
    "first_draft_ready_v2", "First Draft Ready",
    "Editor {{1}} has completed the first draft of {{2}}.\nClient: {{3}}\n"
    "Review it in Kontent OS and move it to QC 2 when ready.",
    ["Farah", "Diwali campaign teaser", "Dhan"],
    ["actor_name", "job_title", "pod_name"],
    "tl", "Editor submitted the first draft for TL review.",
)
_message(
    "video_sent_qc2_v2", "Video Sent for QC2",
    "Hey {{1}}, {{2}} has sent a video for quality check.\n"
    "Video: {{3}}\nClient: {{4}}\n"
    "Complete QC and update the status in Kontent OS.",
    ["Nikhil", "Rahul", "Diwali campaign teaser", "Dhan"],
    ["recipient_name", "actor_name", "job_title", "pod_name"],
    "qc", "TL sent a video to QC 2.",
)
_message(
    "qc_approved_v2", "QC Completed",
    "QC 2 has approved the draft of {{1}}.\n"
    "No changes are required from your end. Wait for the TL's next step in Kontent OS.",
    ["Diwali campaign teaser"], ["job_title"],
    "editor", "QC 2 approved the video.",
)
_message(
    "qc_changes_v2", "QC Changes Ready",
    "QC 2 has completed the review of {{1}}.\n"
    "Changes are in Kontent OS. Review the feedback, make the changes, "
    "then update the status there.",
    ["Diwali campaign teaser"], ["job_title"],
    "editor", "QC 2 requested changes.",
)
_message(
    "qc2_completed_tl_v2", "QC2 Completed",
    "Hey {{1}}, QC 2 is complete for {{2}}.\nClient: {{3}}\n"
    "Reviewed by: {{4}}\nResult: {{5}}\n"
    "Open Kontent OS for the next step.",
    ["Rahul", "Diwali campaign teaser", "Dhan", "Nikhil", "Approved, ready for your final review"],
    ["recipient_name", "job_title", "pod_name", "actor_name", "qc2_result"],
    "tl", "QC 2 approved the video or sent it back with changes.",
)
_message(
    "final_draft_ready_v2", "Final Draft Ready",
    "Editor {{1}} has completed the requested changes for {{2}}.\nClient: {{3}}\n"
    "Review the revised cut in Kontent OS. Complete QC 2 and final review "
    "before marking it Delivered.",
    ["Farah", "Diwali campaign teaser", "Dhan"],
    ["actor_name", "job_title", "pod_name"],
    "tl", "Editor resubmitted changes for TL review.",
)
_message(
    "video_delivered_v2", "Video Delivered",
    "Video {{1}} has been reviewed and delivered by {{2}}.\n"
    "Great work, {{3}}! Job completed. The record is in Kontent OS.",
    ["Diwali campaign teaser", "Rahul", "Farah"],
    ["job_title", "actor_name", "recipient_name"],
    "editor", "TL marked the video Delivered.",
)
_message(
    "deadline_approaching_v2", "Deadline Reminder",
    "Hey {{1}}, the deadline for {{2}} is approaching.\n"
    "Deadline: {{3}}\nCurrent status: {{4}}\n"
    "Complete it within the assigned timeline. Open job: {{5}}\n"
    "Keep the job updated in Kontent OS.",
    ["Farah", "Diwali campaign teaser", "24 Sep", "Editing", "https://kontent.media/jobs/example"],
    ["recipient_name", "job_title", "deadline", "stage_label", "job_url"],
    "editor", "An incomplete video is due today or tomorrow.",
)
_message(
    "deadline_missed_v2", "Deadline Missed",
    "The deadline for {{1}} has passed.\nClient: {{2}}\n"
    "Deadline: {{3}}\nCurrent status: {{4}}\n"
    "Update the job in Kontent OS and coordinate with {{5}} immediately.\n"
    "Open job: {{6}}\nThe job record remains in Kontent OS.",
    ["Diwali campaign teaser", "Dhan", "24 Sep", "Editing", "Rahul", "https://kontent.media/jobs/example"],
    ["job_title", "pod_name", "deadline", "stage_label", "tl_name", "job_url"],
    "editor", "An incomplete video passed its team deadline.",
)
_message(
    "video_reassigned_v2", "Video Reassigned",
    "Hey {{1}}, a video has been assigned to you.\n"
    "Video: {{2}}\nClient: {{3}}\nDeadline: {{4}}\n"
    "Open job: {{5}}\nReview existing progress and continue in Kontent OS.",
    ["Farah", "Diwali campaign teaser", "Dhan", "24 Sep", "https://kontent.media/jobs/example"],
    ["recipient_name", "job_title", "pod_name", "deadline", "job_url"],
    "editor", "TL reassigned the job to a new editor.",
)


def get(name: str) -> TemplateSpec | None:
    return TEMPLATES.get(name)


def all_specs() -> list[TemplateSpec]:
    return sorted(TEMPLATES.values(), key=lambda s: s.name)
