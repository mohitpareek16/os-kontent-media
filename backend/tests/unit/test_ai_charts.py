"""Charting: the spec the model builds, and how the loop handles it.

Two things are worth pinning down here. The first is that `render_chart`
refuses a chart that would render wrong — a series shorter than its labels
silently shifts every later point onto the wrong date, which is a chart that
lies rather than a chart that fails.

The second is the handshake in `agent.py`: the spec goes to the browser and
does *not* go back into the model's context. That split is easy to undo by
accident and expensive when it is — the numbers get paid for again on every
later turn of the conversation.
"""
from __future__ import annotations

import pytest

from app.services.ai.agent import run_agent
from app.services.ai.tools import run_tool
from tests.stubs import StubClient, says, tool_call

pytestmark = pytest.mark.asyncio


GOOD_CHART = {
    "chart_type": "bar",
    "title": "Deliveries by client",
    "labels": ["Acme", "Globex"],
    "series_names": ["Delivered"],
    "series_values": [[12, 7]],
    "value_format": "number",
}


async def chart(db, user, **overrides):
    return await run_tool(db, user, name="render_chart", arguments={**GOOD_CHART, **overrides})


async def test_a_valid_chart_comes_back_as_a_spec(db, world):
    result = await chart(db, world.tl)

    spec = result["chart_spec"]
    assert spec["chart_type"] == "bar"
    assert spec["labels"] == ["Acme", "Globex"]
    assert spec["series"] == [{"name": "Delivered", "values": [12, 7]}]


async def test_a_series_that_does_not_line_up_with_the_labels_is_refused(db, world):
    """The failure this prevents is silent: a short series renders, it just
    renders the wrong numbers against the wrong labels."""
    result = await chart(db, world.tl, series_values=[[12]])

    assert "error" in result
    assert "1 values but there are 2 labels" in result["error"]
    assert "chart_spec" not in result


async def test_a_series_without_a_name_is_refused(db, world):
    result = await chart(db, world.tl, series_names=["A", "B"], series_values=[[1, 2]])

    assert "must line up one-to-one" in result["error"]


async def test_a_pie_with_two_series_is_refused_rather_than_half_drawn(db, world):
    result = await chart(
        db,
        world.tl,
        chart_type="pie",
        series_names=["This month", "Last month"],
        series_values=[[12, 7], [9, 8]],
    )

    assert "one series only" in result["error"]


async def test_too_many_points_is_refused_with_advice(db, world):
    labels = [f"day-{i}" for i in range(90)]
    result = await chart(db, world.tl, labels=labels, series_values=[[1] * 90])

    assert "Too many points" in result["error"]
    assert "wider buckets" in result["error"]


async def test_the_chart_reaches_the_browser_but_not_the_model(db, world):
    """The spec is streamed and stored; the model gets a short ack instead.

    Feeding the series back would charge for those numbers again on every
    later turn, to tell the model something it just said.
    """
    events: list[tuple[str, dict]] = []

    async def emit(event, data):
        events.append((event, data))

    client = StubClient([tool_call("render_chart", GOOD_CHART), says("Acme leads on 12.")])
    result = await run_agent(
        db, world.tl, client=client, question="chart it", emit=emit
    )

    assert result.answer == "Acme leads on 12."
    assert [spec["title"] for spec in result.charts] == ["Deliveries by client"]

    charted = [data for event, data in events if event == "chart"]
    assert charted[0]["series"] == [{"name": "Delivered", "values": [12, 7]}]

    fed_back = client.tool_results[0]["content"]
    assert "chart_spec" not in fed_back
    assert fed_back["ok"] is True
    assert "is now displayed to the user" in fed_back["rendered"]


async def test_several_charts_in_one_answer_are_all_kept(db, world):
    client = StubClient(
        [
            tool_call("render_chart", GOOD_CHART, call_id="c1"),
            tool_call("render_chart", {**GOOD_CHART, "title": "Rounds by client"}, call_id="c2"),
            says("Two charts."),
        ]
    )
    result = await run_agent(db, world.tl, client=client, question="chart both")

    assert [spec["title"] for spec in result.charts] == [
        "Deliveries by client",
        "Rounds by client",
    ]


async def test_a_refused_chart_produces_no_chart_and_no_crash(db, world):
    client = StubClient(
        [
            tool_call("render_chart", {**GOOD_CHART, "series_values": [[1]]}),
            says("I got the shape wrong."),
        ]
    )
    result = await run_agent(db, world.tl, client=client, question="chart it")

    assert result.charts == []
    assert result.tool_calls[0].ok is False
