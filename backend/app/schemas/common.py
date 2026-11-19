"""The shape every list endpoint answers in.

Filtering, sorting and paging happen in SQL — a list route returns the one
page that was asked for plus the `total` behind it. Without that total a
client can only paginate what it already has, which is how several screens
ended up downloading five hundred rows to show twenty: the count and the
filtering had nowhere else to live. See docs/06-frontend-rules.md.

`JobListResponse` predates this and has the identical shape; it stays where
it is so the jobs schema reads as one file.
"""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    #: Rows matching the filters, not rows in this page — what the pager counts.
    total: int
    page: int
    page_size: int
