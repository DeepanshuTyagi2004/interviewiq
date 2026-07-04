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


def test_lld_round_rejects_dsa_request():
    assert out_of_scope_by_markers(RoundType.LLD, "can you ask me a dsa question instead") is True


def test_hiring_manager_round_rejects_dsa_request():
    assert out_of_scope_by_markers(RoundType.HIRING_MANAGER, "ask me a dsa problem instead") is True


def test_system_design_round_rejects_dsa_with_leetcode():
    assert out_of_scope_by_markers(RoundType.SYSTEM_DESIGN, "give me a leetcode dsa problem") is True


def test_lld_round_allows_design_patterns_and_solid():
    assert out_of_scope_by_markers(RoundType.LLD, "ask me about design patterns and SOLID") is False
