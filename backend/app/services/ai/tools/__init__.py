"""Tool package. Importing it registers every tool.

The module imports below are the registration — each one runs its `@tool`
decorators as a side effect. Adding a question the bot can answer means
adding a module here and nothing else; the agent, the router and the
frontend all read the registry rather than a hand-kept list.
"""
from app.services.ai.tools import (  # noqa: F401
    capacity,
    charts,
    editors,
    entities,
    jobs,
    library,
    pods,
    roster,
    trends,
)
from app.services.ai.tools.base import (
    DEFAULT_ROLES,
    ToolSpec,
    all_specs,
    run_tool,
    schemas_for,
    specs_for,
    tool,
)

__all__ = [
    "DEFAULT_ROLES",
    "ToolSpec",
    "all_specs",
    "run_tool",
    "schemas_for",
    "specs_for",
    "tool",
]
