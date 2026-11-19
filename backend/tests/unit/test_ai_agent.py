"""The tool-calling loop, driven by a scripted model (`tests/stubs.py`).

No key, no network, no nondeterminism — the assertions are about what the
loop *does* with what the model says, which is the part that has to keep
working when the model behind it is swapped.
"""
from __future__ import annotations

import pytest

from app.services.ai.agent import run_agent
from app.services.ai.history import HISTORY_TURNS, load_history, record_exchange, start_conversation
from app.services.ai.tools import schemas_for
from tests.factories import make_job
from tests.stubs import StubClient, says, tool_call

pytestmark = pytest.mark.asyncio


async def test_answers_without_tools_when_it_does_not_need_them(db, world):
    client = StubClient([says("Hello.")])
    result = await run_agent(db, world.tl, client=client, question="hi")

    assert result.answer == "Hello."
    assert result.tool_calls == []
    assert result.iterations == 1
    assert result.hit_iteration_cap is False


async def test_runs_a_tool_and_feeds_the_result_back(db, world):
    await make_job(db, pod=world.pod, created_by=world.tl, title="Launch film")
    await db.commit()

    client = StubClient([tool_call("find_jobs", {}), says("You have 1 open job.")])
    result = await run_agent(db, world.tl, client=client, question="what's open?")

    assert result.answer == "You have 1 open job."
    assert [c.name for c in result.tool_calls] == ["find_jobs"]
    assert result.tool_calls[0].ok is True

    fed_back = client.tool_results[0]["content"]
    assert fed_back["jobs"][0]["title"] == "Launch film"


async def test_prose_written_alongside_a_tool_call_is_not_thrown_away(db, world):
    """Some models write the answer next to the tool call and then close with
    an empty message — they have already said everything they meant to.

    The loop used to keep the last message's content and nothing else, so that
    whole answer vanished and the user got a blank reply under a chart. Found
    live: the same question answered fine on one model and came back empty on
    another purely because of where each chose to put its words.
    """
    client = StubClient(
        [
            tool_call("find_jobs", {}, content="You have 1 open job: Launch film."),
            says(""),
        ]
    )
    result = await run_agent(db, world.tl, client=client, question="what's open?")

    assert result.answer == "You have 1 open job: Launch film."


async def test_a_closing_message_wins_over_the_running_commentary(db, world):
    """The fallback must not become a prefix. A model that narrates *and*
    summarises should not have the narration stapled to the front of its
    summary — the closing message saw every tool result."""
    client = StubClient(
        [
            tool_call("find_jobs", {}, content="Let me check that for you."),
            says("You have 1 open job."),
        ]
    )
    result = await run_agent(db, world.tl, client=client, question="what's open?")

    assert result.answer == "You have 1 open job."


async def test_the_model_is_only_offered_tools_its_caller_may_use(db, world):
    client = StubClient([says("ok")])
    await run_agent(db, world.tl, client=client, question="hi")

    offered = {t["function"]["name"] for t in client.calls[0]["tools"]}
    assert offered == {t["function"]["name"] for t in schemas_for(world.tl)}
    assert "get_pod_health" in offered


async def test_a_refused_tool_is_reported_to_the_model_not_raised(db, world):
    """A 403 out of a tool must not abort the conversation — the bot has to
    be able to say "I can't see that" instead of returning a 500."""
    client = StubClient(
        [
            tool_call("get_pod_health", {"pod_id": str(world.other_pod.id)}),
            says("I can't see that client."),
        ]
    )
    result = await run_agent(db, world.tl, client=client, question="how's Globex?")

    assert result.answer == "I can't see that client."
    assert result.tool_calls[0].ok is False
    assert client.tool_results[0]["content"]["status"] == 403


async def test_malformed_tool_arguments_come_back_as_a_correctable_error(db, world):
    client = StubClient([tool_call("find_jobs", "{not json"), says("Let me try again.")])
    result = await run_agent(db, world.tl, client=client, question="jobs?")

    assert result.tool_calls[0].ok is False
    assert "valid JSON" in client.tool_results[0]["content"]["error"]
    assert result.answer == "Let me try again."


async def test_iteration_cap_forces_an_answer_instead_of_erroring(db, world):
    """After the cap, tools are taken away and the model has to answer from
    what it already has. Erroring out would charge for every round-trip and
    then throw the work away."""
    client = StubClient([], always=tool_call("find_jobs", {}))
    client.script = [tool_call("find_jobs", {}), tool_call("find_jobs", {}), says("Here's what I found.")]

    result = await run_agent(db, world.tl, client=client, question="jobs?", max_iterations=2)

    assert result.hit_iteration_cap is True
    assert result.answer == "Here's what I found."
    assert len(client.calls) == 3
    # The final call is the one with no tools on offer.
    assert client.calls[-1]["tools"] is None


async def test_iteration_cap_still_answers_when_the_model_says_nothing(db, world):
    client = StubClient([tool_call("find_jobs", {}), says("")], always=says(""))
    result = await run_agent(db, world.tl, client=client, question="jobs?", max_iterations=1)

    assert result.hit_iteration_cap is True
    assert "ran out of lookups" in result.answer


async def test_progress_events_are_emitted_for_each_tool(db, world):
    seen: list[tuple[str, dict]] = []

    async def emit(event, data):
        seen.append((event, data))

    client = StubClient([tool_call("find_jobs", {}), says("done")])
    await run_agent(db, world.tl, client=client, question="jobs?", emit=emit)

    assert [e for e, _ in seen] == ["tool", "tool"]
    assert seen[0][1] == {"name": "find_jobs", "status": "running", "arguments": {}}
    assert seen[1][1] == {"name": "find_jobs", "status": "done"}


async def test_system_prompt_carries_the_date_and_the_caller(db, world):
    from datetime import date

    client = StubClient([says("ok")])
    await run_agent(db, world.tl, client=client, question="hi")

    system = client.calls[0]["messages"][0]
    assert system["role"] == "system"
    assert date.today().isoformat() in system["content"]
    assert world.tl.name in system["content"]
    assert "Team Lead" in system["content"]


async def test_usage_is_summed_across_rounds(db, world):
    client = StubClient([tool_call("find_jobs", {}), says("done")])
    result = await run_agent(db, world.tl, client=client, question="jobs?")

    assert result.usage["total_tokens"] == 25


async def test_history_replays_turns_but_never_tool_traffic(db, world):
    """Old tool results are deliberately not replayed: they would grow the
    context every message with numbers that can be looked up again, and a
    stale figure presented as current is worse than a second query."""
    conversation = await start_conversation(db, user=world.tl, first_message="how's Acme?")
    await record_exchange(
        db,
        conversation=conversation,
        question="how's Acme?",
        answer="Fine.",
        tool_calls=[{"name": "get_pod_health", "arguments": {}, "ok": True}],
        model="stub/model",
        usage={},
    )
    await db.commit()

    history = await load_history(db, conversation_id=conversation.id)
    assert [m["role"] for m in history] == ["user", "assistant"]
    assert all("tool" not in m["role"] for m in history)
    assert history[0]["content"] == "how's Acme?"


async def test_history_is_capped(db, world):
    conversation = await start_conversation(db, user=world.tl, first_message="q")
    for i in range(HISTORY_TURNS):
        await record_exchange(
            db,
            conversation=conversation,
            question=f"q{i}",
            answer=f"a{i}",
            tool_calls=[],
            model="stub/model",
            usage={},
        )
    await db.commit()

    history = await load_history(db, conversation_id=conversation.id)
    assert len(history) == HISTORY_TURNS
    # Oldest-first, and it kept the *latest* turns.
    assert history[-1]["content"] == f"a{HISTORY_TURNS - 1}"
