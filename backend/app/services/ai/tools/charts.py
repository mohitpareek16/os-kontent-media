"""Charting — the model describes a chart, the browser draws it.

The model does not produce an image. It calls `render_chart` with a spec of
numbers it has already looked up, and the frontend renders that spec with
Recharts. That split is deliberate:

- **The numbers stay auditable.** A chart is a claim about data, and the
  claim is stored on the message next to `tool_calls`. "The bot showed me a
  graph saying Aditya delivered 14" is answerable from the row, exactly like
  a quoted figure is.
- **It renders in the app's own design language**, in both themes, and stays
  legible when a thread is reopened on a phone. A PNG from a model would be
  none of those things.
- **No new model capability is required.** Every model that can call a tool
  can fill in this schema, which matters because the deployed model is a
  cheap one (`google/gemini-2.5-flash`) chosen for tool-calling, not for
  image generation.

The spec deliberately never leaves this file as free-form JSON: it is a
Pydantic model with the same rules as any other tool's arguments, so a
malformed chart comes back as a correctable error rather than a component
crash in someone's browser.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.ai.tools.base import tool

# Caps, not arbitrary. Beyond these a chart stops being readable and starts
# being a table with extra steps, and the payload starts costing real tokens
# on every turn of the conversation it appears in.
MAX_POINTS = 60
MAX_SERIES = 8

class RenderChartArgs(BaseModel):
    chart_type: Literal[
        "bar", "grouped_bar", "stacked_bar", "line", "area", "pie", "donut"
    ] = Field(
        description=(
            "bar for one value per category; grouped_bar or stacked_bar to compare "
            "several series across the same categories; line or area for anything "
            "over time; pie or donut only for parts of one whole (max ~6 slices)."
        )
    )
    title: str = Field(
        min_length=1, max_length=120, description="What the chart shows, e.g. 'Deliveries by week'."
    )
    labels: list[str] = Field(
        description=(
            "The x-axis categories, in the order they should appear — dates, weeks, "
            "editor names, stage names. For pie charts these are the slice labels."
        )
    )
    series_names: list[str] = Field(
        description=(
            "One name per series, e.g. ['Dhan', 'Nykaa']. For a single-series chart "
            "pass one name describing the measure, e.g. ['Deliveries']."
        )
    )
    series_values: list[list[float]] = Field(
        description=(
            "One inner list per entry in series_names, each holding one number per "
            "entry in labels, in the same order. Use real numbers you got from a "
            "lookup tool — never estimates."
        )
    )
    y_label: str | None = Field(
        default=None, max_length=60, description="What the numbers measure, e.g. 'Jobs delivered'."
    )
    value_format: Literal["number", "percent", "days", "points"] = Field(
        default="number",
        description=(
            "How to format the numbers. Use 'percent' for rates and pass them as 0-100, "
            "not 0-1. 'points' means QC2 review points — the only kind there is."
        ),
    )
    note: str | None = Field(
        default=None,
        max_length=200,
        description="One line of context under the chart, e.g. the date window it covers.",
    )


@tool(
    name="render_chart",
    description=(
        "Draw a chart in the conversation from numbers you have already looked up. "
        "Use this whenever the user asks for a graph, chart, trend or visual, and "
        "reach for it unprompted when a comparison across clients, people, stages or "
        "time would be clearer as a picture. Call it AFTER the lookup tools that "
        "produced the numbers. You may call it more than once for several charts. "
        "Always also say the headline numbers in your written answer — the chart "
        "supports the answer, it is not the answer."
    ),
    args_model=RenderChartArgs,
)
async def render_chart(db: AsyncSession, user: User, args: RenderChartArgs) -> dict:
    """Validate the shape and hand back a spec for the frontend.

    No database access at all — every number here was already fetched by a
    tool that enforced permissions on it. This is a formatting step, so it
    adds no new way to reach data and needs no scope check of its own.
    """
    if not args.labels:
        return {"error": "labels is empty. Give at least one category to plot."}
    if len(args.labels) > MAX_POINTS:
        return {
            "error": (
                f"Too many points ({len(args.labels)}). Charts take at most {MAX_POINTS}. "
                "Aggregate into wider buckets — weeks instead of days — or plot the top few."
            )
        }
    if not args.series_names:
        return {"error": "series_names is empty. Name at least one series."}
    if len(args.series_names) > MAX_SERIES:
        return {
            "error": (
                f"Too many series ({len(args.series_names)}). At most {MAX_SERIES} stay "
                "readable. Plot the largest few and say what you left out."
            )
        }
    if len(args.series_names) != len(args.series_values):
        return {
            "error": (
                f"series_names has {len(args.series_names)} entries but series_values has "
                f"{len(args.series_values)}. They must line up one-to-one."
            )
        }

    for name, values in zip(args.series_names, args.series_values):
        if len(values) != len(args.labels):
            return {
                "error": (
                    f"Series '{name}' has {len(values)} values but there are "
                    f"{len(args.labels)} labels. Every series needs one number per label. "
                    "Use 0 for a category with no data."
                )
            }

    # A pie is a single whole cut into parts. Two series in a pie is not a
    # chart anyone can read, and silently drawing the first one would be a
    # quiet lie about what was plotted.
    if args.chart_type in ("pie", "donut") and len(args.series_names) > 1:
        return {
            "error": (
                "Pie and donut charts show one series only. Use grouped_bar to compare "
                "several series, or draw one pie per series."
            )
        }

    spec = {
        "chart_type": args.chart_type,
        "title": args.title,
        "labels": args.labels,
        "series": [
            {"name": name, "values": values}
            for name, values in zip(args.series_names, args.series_values)
        ],
        "y_label": args.y_label,
        "value_format": args.value_format,
        "note": args.note,
    }

    # `chart_spec` is the handshake with the agent loop, which lifts it out
    # of the result and streams it to the browser rather than feeding it
    # back to the model. The model gets the short ack below instead: it
    # already knows these numbers, and echoing the whole series back into
    # context would pay for them twice on every subsequent turn.
    return {
        "chart_spec": spec,
        "ok": True,
        "rendered": (
            f"{args.chart_type} chart '{args.title}' is now displayed to the user with "
            f"{len(args.series_names)} series over {len(args.labels)} points. Do not "
            "describe the chart's appearance — summarise what it shows in numbers."
        ),
    }
