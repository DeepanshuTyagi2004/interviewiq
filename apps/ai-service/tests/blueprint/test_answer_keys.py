"""Answer keys (spec §6 stage 3): sandbox-verified DSA keys, swaps, caching, non-DSA extras."""
import asyncio

import pytest

from app.blueprint import answer_keys as K
from app.blueprint import selection as S
from app.blueprint import store
from app.blueprint.context import build_context
from app.blueprint.trace import StageError
from app.llm.client import LLMError
from tests.blueprint.fixtures import FakeLLM, MemoryTrace, behavioural_doc, dsa_doc, dsa_key_reply, request


class _Settings:
    blueprint_concurrency = 2
    blueprint_parallel = 2
    blueprint_quota_retries = 0
    blueprint_transient_retries = 0


@pytest.fixture()
def bank(monkeypatch):
    docs: dict[str, dict] = {}
    saved: dict[str, dict] = {}

    async def bank_problem(rt, slug):
        return docs.get(slug)

    async def get_key(key_id):
        return saved.get(key_id)

    async def save_key(doc):
        saved[doc["key_id"]] = doc

    monkeypatch.setattr(store, "bank_problem", bank_problem)
    monkeypatch.setattr(store, "get_answer_key", get_key)
    monkeypatch.setattr(store, "save_answer_key", save_key)
    return docs, saved


def _plans(docs):
    ctx = build_context(request())
    pool = list(docs.values())
    return ctx, S.select(ctx, pool, S.DEFAULT_WEIGHTS, "seed")[0]


def test_dsa_key_is_verified_against_examples_and_cached(bank):
    docs, saved = bank
    p = dsa_doc("sum-it")
    key, hit = asyncio.run(K.key_for(FakeLLM({"answer_key": dsa_key_reply()}), MemoryTrace(), p, _Settings(), bypass_cache=False))
    assert not hit and key["reference_solution"]["verified_against_examples"] is True
    assert len(saved) == 1
    again, hit2 = asyncio.run(K.key_for(FakeLLM({}), MemoryTrace(), p, _Settings(), bypass_cache=False))
    assert hit2 and again == key


def test_a_wrong_solution_gets_one_repair_then_fails_and_is_not_cached(bank):
    docs, saved = bank
    wrong = dsa_key_reply("def solve(nums):\n    return 0\n")
    llm = FakeLLM({"answer_key": [wrong, wrong]})
    with pytest.raises(K.KeyFailed):
        asyncio.run(K.key_for(llm, MemoryTrace(), dsa_doc("sum-it"), _Settings(), bypass_cache=False))
    assert [c[0] for c in llm.calls] == ["answer_key:sum-it", "answer_key:sum-it:repair"]
    assert "expected 3, got 0" in llm.calls[1][1] and saved == {}


def test_failed_key_swaps_the_slot_to_its_next_candidate(bank, monkeypatch):
    docs, _ = bank
    for d in [dsa_doc(f"p{i}", tags=(t,)) for i, t in enumerate(["Array", "Graph", "Dynamic Programming", "Greedy", "Math", "Heap"])]:
        docs[d["slug"]] = d
    docs["hard"] = dsa_doc("hard", tags=("Trie",), difficulty="hard")
    ctx, plans = _plans(docs)
    bad = plans[0].pick.slug
    good = dsa_key_reply()
    wrong = dsa_key_reply("def solve(nums):\n    return -1\n")

    class Picky(FakeLLM):
        async def complete_full(self, system, user, *, label=""):
            return await super().complete_full(system, user, label="bad" if label.startswith(f"answer_key:{bad}") else "good")

    keyed = asyncio.run(K.build_answer_keys(ctx, plans, Picky({"bad": wrong, "good": good}), MemoryTrace(), _Settings()))
    assert keyed["core-1"]["problem"]["slug"] != bad
    assert plans[0].swaps and plans[0].swaps[0]["slug"] == bad
    assert any(r["slug"] == bad and r["outcome"] == "swapped_out" for r in plans[0].considered)


def test_no_passing_candidate_fails_the_run(bank):
    docs, _ = bank
    for d in [dsa_doc(f"p{i}", tags=(t,)) for i, t in enumerate(["Array", "Graph", "Greedy"])] + [dsa_doc("h", tags=("Heap",), difficulty="hard")]:
        docs[d["slug"]] = d
    ctx, plans = _plans(docs)
    wrong = dsa_key_reply("def solve(nums):\n    return -1\n")
    with pytest.raises(StageError) as err:
        asyncio.run(K.build_answer_keys(ctx, plans, FakeLLM({"answer_key": wrong}), MemoryTrace(), _Settings()))
    assert err.value.code == "answer_key_failed"


def test_behavioural_key_keeps_the_bank_base_and_adds_extras(bank):
    p = behavioural_doc("conflict-1", "conflict-teamwork")
    extras = {"must_cover": ["their own action"], "key_insights": ["specific", "measurable"],
              "common_wrong_paths": [{"path": "blames others", "why_wrong": "no ownership", "nudge": "What did you do?"},
                                     {"path": "only 'we'", "why_wrong": "hides their role", "nudge": "What was your part?"}],
              "edge_cases": ["no work experience: accept a college project", "a team story with no personal role"]}
    key, _ = asyncio.run(K.key_for(FakeLLM({"answer_key": extras}), MemoryTrace(), p, _Settings(), bypass_cache=False))
    assert key["base"]["strong_answer_summary"] and key["key_insights"] == ["specific", "measurable"]


def test_behavioural_keys_are_cached_per_level_band_and_drop_another_companys_principle(bank):
    _, saved = bank
    p = behavioural_doc("conflict-2", "conflict-teamwork")
    p["content"]["principle"] = "Learn and Be Curious"
    extras = {"must_cover": ["their own action"], "key_insights": ["specific", "measurable"],
              "common_wrong_paths": [{"path": "blames others", "why_wrong": "no ownership", "nudge": "What did you do?"},
                                     {"path": "only 'we'", "why_wrong": "hides their role", "nudge": "What was your part?"}],
              "edge_cases": ["no work experience", "a team story with no personal role"]}
    llm = FakeLLM({"answer_key": extras})
    early, hit1 = asyncio.run(K.key_for(llm, MemoryTrace(), p, _Settings(), bypass_cache=False, band="early"))
    senior, hit2 = asyncio.run(K.key_for(llm, MemoryTrace(), p, _Settings(), bypass_cache=False, band="senior"))
    again, hit3 = asyncio.run(K.key_for(llm, MemoryTrace(), p, _Settings(), bypass_cache=False, band="early"))
    assert (hit1, hit2, hit3) == (False, False, True) and len(saved) == 2
    assert "principle" not in early["base"]
    assert "an intern, new graduate or SDE-1" in llm.calls[0][1] and "staff, principal or distinguished" in llm.calls[1][1]


def test_dsa_keys_get_a_reviewer_pass_and_only_reviewed_keys_are_cached(bank):
    _, saved = bank
    p = dsa_doc("sum-reviewed")
    bad = dsa_key_reply()
    bad["approaches"][1]["time_complexity"] = "O(n^2)"
    review = {"errors": [{"field": "approaches", "claim": "O(n^2)", "correction": "one pass is O(n)"}],
              "approaches": [{"name": "Brute force", "idea": "try every pair of values", "time_complexity": "O(n^2)", "space_complexity": "O(1)"},
                             {"name": "Sum", "idea": "add all the values together", "time_complexity": "O(n)", "space_complexity": "O(1)"}]}
    key, _ = asyncio.run(K.key_for(FakeLLM({"answer_key:sum-reviewed:review": review, "answer_key": bad}), MemoryTrace(), p,
                                   _Settings(), bypass_cache=False))
    assert key["reviewed"] and key["approaches"][1]["time_complexity"] == "O(n)" and len(saved) == 1
    # A review that can't run leaves the key unreviewed and uncached.
    p2 = dsa_doc("sum-unreviewed")
    failing = FakeLLM({"answer_key:sum-unreviewed:review": LLMError("Research LLM failed (groq:http_400)"), "answer_key": dsa_key_reply()})
    key2, hit = asyncio.run(K.key_for(failing, MemoryTrace(), p2, _Settings(), bypass_cache=False))
    assert not key2.get("reviewed") and not hit and len(saved) == 1
