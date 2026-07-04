from app.interview_agent.scope import out_of_scope_by_markers, scope_prompt_context
from app.interview_agent.types import RoundType


def test_dsa_round_rejects_system_design_request():
    assert out_of_scope_by_markers(RoundType.DSA, "can you ask me a system design question instead") is True
    assert out_of_scope_by_markers(RoundType.DSA, "ask me about HLD / scalability") is True
    assert out_of_scope_by_markers(RoundType.DSA, "let's do a behavioural question") is True


def test_dsa_round_allows_other_dsa_or_cs_fundamentals():
    assert out_of_scope_by_markers(RoundType.DSA, "I'm weak at graphs, can you ask DP instead") is False
    assert out_of_scope_by_markers(RoundType.DSA, "ask me something on operating systems") is False


def test_behavioural_round_rejects_any_coding():
    assert out_of_scope_by_markers(RoundType.BEHAVIOURAL, "give me a dsa coding problem") is True


def test_scope_prompt_context_names_the_round():
    ctx = scope_prompt_context(RoundType.DSA)
    assert "DSA" in ctx or "data structures" in ctx.lower()
