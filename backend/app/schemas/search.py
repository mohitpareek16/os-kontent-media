"""What the header's global search box gets back.

Deliberately not `JobRead` / `PodRead` / `UserRead`: a result row shows a
line of text and navigates somewhere, so it carries what is drawn plus the
id it links to, and nothing else. Reusing the full read schemas here would
put a person's phone number and capacity into a dropdown that only prints
their name.

Every hit does carry enough context to be *worth* landing on, though. A row
that only repeats the word you typed makes you click it to find out whether
it was the one you meant — which is the click the search was supposed to
save.
"""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

#: Why a job came back for a query that isn't in its own title or code. The
#: row prints it ("via client Dhan"), because a result whose text does not
#: contain what you typed is otherwise indistinguishable from a broken search.
JobMatchReason = Literal["job", "pod", "channel", "editor", "tl", "reviewer"]


class JobHit(BaseModel):
    id: uuid.UUID
    code: str
    title: str
    stage: str
    pod_id: uuid.UUID
    pod_name: str
    #: Which of the client's channels it is filed under, if any.
    channel_name: str | None = None
    #: Whoever is cutting it. Part of the row because "who has this one" is
    #: half of what people are checking when they search a job by name.
    editor_name: str | None = None
    matched_on: JobMatchReason = "job"
    #: Set when the project was killed. The row is still worth finding by
    #: name — see `services/search.py::search_jobs` — but must be labelled,
    #: because nowhere else in the product does a scrapped job appear.
    scrapped_at: datetime | None


class PodHit(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    tl_name: str | None = None
    #: Live work in this pod, scoped to what the searcher can see.
    open_jobs: int = 0
    #: Channels the client is still publishing to.
    channels: int = 0


class ChannelHit(BaseModel):
    """One destination inside a client pod — "Dhan HQ", "AAD".

    Its own result kind because it is usually the row somebody actually
    wanted: a channel is where the work goes, and the pipeline table can
    filter by one. Matching a channel on its *client's* name too is what makes
    typing "dhan" answer with Dhan's channels.
    """

    id: uuid.UUID
    name: str
    pod_id: uuid.UUID
    pod_name: str
    open_jobs: int = 0
    #: Retired, not deleted — it still names the work that went to it, which
    #: is exactly why somebody searches an old one. Labelled, not hidden.
    archived: bool = False


class PersonHit(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    is_active: bool
    #: The clients they work on, as far as the searcher can see.
    pods: list[str] = []
    #: Live jobs they are the editor or the QC2 reviewer of.
    open_jobs: int = 0


class SearchResults(BaseModel):
    #: Echoed back so a client can drop a response that arrived after the
    #: user has already typed on — searches race, and the last one to land
    #: is not necessarily the last one asked.
    query: str
    jobs: list[JobHit]
    pods: list[PodHit]
    channels: list[ChannelHit]
    people: list[PersonHit]
