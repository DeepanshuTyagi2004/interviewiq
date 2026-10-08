"""Content generation per record: validate, verify, patch; inferred fills; skips and failures."""
import asyncio

import pytest

import app.questions.content.generate as gen
from app.questions.content.prompts import CONTENT_VERSION, build_content_prompt
from app.questions.hashing import compute_content_hash
from app.questions.models import QuestionRecord
from tests.test_question_content_models import full_dsa


def _settings():
    from app.config import Settings
    return Settings()


class _Result:
    def __init__(self, data, model="groq/test"):
        self.data, self.model = data, model


class _LLM:
    def __init__(self, data):
        self.data, self.calls = data, []

    async def complete_full(self, system, user, *, label=""):
        self.calls.append((system, user, label))
        return _Result(self.data)

    async def aclose(self):
        pass


class _Sequence(_LLM):
    def __init__(self, datas):
        super().__init__(datas[0])
        self.datas = list(datas)

    async def complete_full(self, system, user, *, label=""):
        self.calls.append((system, user, label))
        return _Result(self.datas.pop(0) if len(self.datas) > 1 else self.datas[0])


def _record(**overrides):
    base = dict(slug="longest-run", round_type="dsa", title="Longest Run Under Capacity", url="https://leetcode.com/problems/longest-run/",
                company_tags=["amazon"], topic_tags=["Array"], difficulty=None, level_tags=[])
    base.update(overrides)
    return QuestionRecord(**base).model_dump(mode="json")


def _patches(monkeypatch):
    saved = []

    async def fake_update(round_type, slug, patch):
        saved.append((round_type, slug, patch))
    monkeypatch.setattr(gen.repo, "update_question_content", fake_update)
    monkeypatch.setattr(gen.RUN_STORE, "is_cancelled", lambda: False)
    return saved


def test_dsa_content_is_proven_by_two_solutions_and_inferred_facts_fill_gaps(monkeypatch):
    saved = _patches(monkeypatch)
    llm = _LLM({"inferred": {"difficulty": "medium", "level_tags": ["fresher", "sde1"], "topic_tags": ["Sliding Window"], "company_tags": ["Flipkart", "amazon"]}, "content": full_dsa()})
    status = asyncio.run(gen.generate_one(llm, _record(), _settings(), "2026-10-07T00:00:00Z"))
    assert status == "verified" and len(llm.calls) == 1
    (_, slug, patch), = saved
    assert slug == "longest-run" and patch["content_status"] == "verified" and patch["content_error"] is None
    assert patch["content_version"] == CONTENT_VERSION and patch["content_model"] == "groq/test"
    assert patch["difficulty"] == "medium" and patch["level_tags"] == ["fresher", "sde1"] and patch["topic_tags"] == ["Array", "Sliding Window"]
    assert patch["company_tags"] == ["amazon", "flipkart"] and patch["company_evidence"] == {"amazon": "reported", "flipkart": "inferred"}
    assert patch["content"]["examples"][0]["expected"] == 3 and patch["content"]["brute_force_solution"]["entry_point"] == "longest_run"
    _, user, label = llm.calls[0]
    assert "Longest Run Under Capacity" in user and "leetcode.com" not in user and label == "content:longest-run"


def test_hidden_expectations_are_computed_from_the_agreeing_solutions_not_trusted(monkeypatch):
    saved = _patches(monkeypatch)
    tests = full_dsa()["judge_tests"]
    tests[1]["expected"] = 99  # a wrong hand-typed value is simply replaced
    status = asyncio.run(gen.generate_one(_LLM({"content": full_dsa(judge_tests=tests)}), _record(), _settings(), "t"))
    assert status == "verified"
    assert saved[0][2]["content"]["judge_tests"][1]["expected"] == 2


def test_a_problem_that_cannot_be_proven_is_stored_failed_with_no_content(monkeypatch):
    saved = _patches(monkeypatch)
    wrong_ref = full_dsa(reference_solution={"language": "python", "entry_point": "longest_run", "code": "def longest_run(weights, capacity):\n    return 42\n"})
    llm = _LLM({"content": wrong_ref})
    assert asyncio.run(gen.generate_one(llm, _record(), _settings(), "t")) == "failed"
    assert len(llm.calls) == _settings().question_content_repair_rounds + 1  # every repair round was spent
    patch = saved[-1][2]
    assert patch["content_status"] == "failed" and patch["content"] is None and "optimal returned 42 but brute-force returned" in patch["content_error"]


def test_a_wrong_example_goes_back_to_the_model_with_the_exact_failure_and_is_then_accepted(monkeypatch):
    saved = _patches(monkeypatch)
    bad = full_dsa()
    bad["examples"][0]["expected"] = 7  # both solutions say 3
    llm = _Sequence([{"content": bad}, {"content": full_dsa()}])
    assert asyncio.run(gen.generate_one(llm, _record(), _settings(), "t")) == "verified"
    assert llm.calls[1][2].startswith("repair:")
    repair_prompt = llm.calls[1][1]
    assert "you wrote expected 7 but your solutions return 3" in repair_prompt and "Previous attempt" in repair_prompt
    assert saved[-1][2]["content_status"] == "verified"


def test_checks_catch_trivial_duplicate_and_constant_problems(monkeypatch):
    _patches(monkeypatch)
    from app.questions.content.models import DsaContent
    settings = _settings()
    verify = lambda c: asyncio.run(gen.verify_dsa(DsaContent.model_validate(c), settings))
    assert verify(full_dsa()) == []
    same_inputs = full_dsa(); same_inputs["examples"][1] = dict(same_inputs["examples"][0])
    assert any("same input" in i for i in verify(same_inputs))
    mismatched_brute = full_dsa(brute_force_solution={"language": "python", "entry_point": "other_name", "code": "def other_name(weights, capacity):\n    return 0\n"})
    assert "same function name" in verify(mismatched_brute)[0]
    echo = full_dsa(
        statement="Return the list unchanged after validating that every weight is positive and within the stated capacity bounds for the warehouse run.",
        reference_solution={"language": "python", "entry_point": "echo", "code": "def echo(weights, capacity):\n    return list(weights)\n"},
        brute_force_solution={"language": "python", "entry_point": "echo", "code": "def echo(weights, capacity):\n    return [w for w in weights]\n"})
    echo["examples"] = [{"args": {"weights": [1, 2], "capacity": 3}, "expected": [1, 2], "explanation": "unchanged"}, {"args": {"weights": [3, 4], "capacity": 3}, "expected": [3, 4], "explanation": "unchanged"}]
    echo["judge_tests"] = [{"args": {"weights": [i, i + 1], "capacity": 9}, "expected": [i, i + 1]} for i in range(5)]
    assert any("trivial" in i for i in verify(echo))


def test_behavioural_content_is_stored_as_generated_without_a_sandbox(monkeypatch):
    saved = _patches(monkeypatch)
    content = {"question": "Tell me about a time you disagreed with a senior engineer.", "competency": "conflict resolution", "what_it_tests": "Backbone and respect.",
               "star_guide": {"situation": "a real design disagreement", "task": "your stake in it", "action": "how you made the case", "result": "what was decided"},
               "strong_answer_summary": "Specific and data-backed, ends with a measurable result.",
               "weak_answer_summary": "Vague and blames others.", "follow_up_probes": ["What changed?", "What would you repeat?"], "estimated_minutes": 8}
    record = _record(slug="hm/disagree", round_type="hiring-manager", title="Tell me about a disagreement", url="", company_tags=[])
    status = asyncio.run(gen.generate_one(_LLM({"inferred": {"company_tags": ["tcs"]}, "content": content}), record, _settings(), "t"))
    assert status == "generated"
    patch = saved[0][2]
    assert patch["company_tags"] == ["tcs"] and patch["company_evidence"] == {"tcs": "inferred"}
    assert "hiring-manager" in build_content_prompt(record) and "deep-dive" in build_content_prompt(record)


def test_generate_content_runs_candidates_with_bounded_concurrency(monkeypatch):
    docs = [_record(slug=f"q{i}") for i in range(3)]

    async def fake_candidates(round_type, version, limit, force):
        assert version == CONTENT_VERSION
        return docs[:limit] if limit else docs
    monkeypatch.setattr(gen.repo, "questions_needing_content", fake_candidates)
    monkeypatch.setattr(gen, "build_content_llm_client", lambda settings, **kw: _LLM({"content": full_dsa()}))
    _patches(monkeypatch)
    settings = _settings()
    settings.question_content_allow_ungrounded = True  # these records have no source statement
    counts = asyncio.run(gen.generate_content(settings, limit=2))
    assert counts["candidates"] == 2 and counts["verified"] == 2 and counts["failed"] == 0


def test_a_generated_problem_survives_a_short_database_blip(monkeypatch):
    calls = []

    async def flaky(round_type, slug, patch):
        calls.append(patch["content_status"])
        if len(calls) < 3:
            raise RuntimeError("no primary")
    monkeypatch.setattr(gen.repo, "update_question_content", flaky)
    monkeypatch.setattr(gen.RUN_STORE, "is_cancelled", lambda: False)

    async def no_sleep(_):
        pass
    monkeypatch.setattr(gen.asyncio, "sleep", no_sleep)
    assert asyncio.run(gen.generate_one(_LLM({"content": full_dsa()}), _record(), _settings(), "t")) == "verified"
    assert calls == ["verified", "verified", "verified"]


def test_quota_exhaustion_waits_and_retries_but_other_errors_fail_fast(monkeypatch):
    saved = _patches(monkeypatch)

    async def no_sleep(_):
        pass
    monkeypatch.setattr(gen.asyncio, "sleep", no_sleep)

    class _Busy(_LLM):
        def __init__(self, data, errors):
            super().__init__(data)
            self.errors = list(errors)

        async def complete_full(self, system, user, *, label=""):
            if self.errors:
                raise RuntimeError(self.errors.pop(0))
            return await super().complete_full(system, user, label=label)

    busy = _Busy({"content": full_dsa()}, ["Research LLM failed (groq:no_eligible_providers)", "HTTP 429 rate limit"])
    assert asyncio.run(gen.generate_one(busy, _record(), _settings(), "t")) == "verified" and len(busy.calls) == 1
    broken = _Busy({"content": full_dsa()}, ["Research LLM failed (groq:invalid_json)"])
    assert asyncio.run(gen.generate_one(broken, _record(), _settings(), "t")) == "failed" and not broken.calls
    assert saved[-1][2]["content_status"] == "failed"


def _source():
    from app.questions.content.source_examples import SourceExample, SourceStatement
    return SourceStatement(title="Longest Run", description="Given weights and a capacity, return the longest contiguous run that fits.\n\nExample 1:\nInput: weights = [2,1,1,3,1], capacity = 4\nOutput: 3\n",
                           examples=[SourceExample({"weights": [2, 1, 1, 3, 1], "capacity": 4}, 3), SourceExample({"weights": [5], "capacity": 4}, 0)])


def test_source_examples_are_ground_truth_and_the_prompt_carries_the_reference_statement(monkeypatch):
    saved = _patches(monkeypatch)
    content = full_dsa()
    content["examples"] = [{"args": {"weights": [9], "capacity": 1}, "expected": 55, "explanation": "my own walkthrough of example one"}, {"args": {"weights": [0], "capacity": 0}, "expected": 55, "explanation": "my own walkthrough of example two"}]
    llm = _LLM({"content": content})
    assert asyncio.run(gen.generate_one(llm, _record(), _settings(), "t", source=_source())) == "verified"
    prompt = llm.calls[0][1]
    assert "REFERENCE STATEMENT" in prompt and "weights, capacity" in prompt and "weights = [2, 1, 1, 3, 1]" in prompt
    stored = saved[-1][2]["content"]["examples"]
    # The model's invented values were replaced by the source's; only its explanations survive.
    assert [e["args"] for e in stored] == [{"weights": [2, 1, 1, 3, 1], "capacity": 4}, {"weights": [5], "capacity": 4}]
    assert [e["expected"] for e in stored] == [3, 0] and stored[0]["explanation"] == "my own walkthrough of example one"


def test_any_order_answers_compare_unordered(monkeypatch):
    _patches(monkeypatch)
    from app.questions.content.models import DsaContent
    c = full_dsa(answer_order_irrelevant=True)
    c["examples"][0] = {"args": {"weights": [2, 1, 1, 3, 1], "capacity": 4}, "expected": 3, "explanation": "x y z"}
    pairs = {"language": "python", "entry_point": "pairs", "code": "def pairs(weights, capacity):\n    return [[1, 0], [3, 2]]\n"}
    brute = {"language": "python", "entry_point": "pairs", "code": "def pairs(weights, capacity):\n    return [[2, 3], [0, 1]]\n"}
    c.update(reference_solution=pairs, brute_force_solution=brute)
    c["examples"] = [{"args": {"weights": [1], "capacity": 1}, "expected": [[0, 1], [2, 3]], "explanation": "any order"}, {"args": {"weights": [2], "capacity": 1}, "expected": [[3, 2], [1, 0]], "explanation": "any order too"}]
    c["judge_tests"] = [{"args": {"weights": [i], "capacity": i}, "expected": None} for i in range(5)]
    settings = _settings()
    issues = asyncio.run(gen.verify_dsa(DsaContent.model_validate(c), settings))
    assert "all examples and tests have the same output" not in " ".join(issues) and not any("example" in i and "return" in i for i in issues)


def test_dsa_without_a_validated_source_is_left_alone_by_default(monkeypatch):
    docs = [_record(slug="grounded"), _record(slug="ungrounded"), _record(slug="hm/x", round_type="hiring-manager", url="")]

    async def fake_candidates(round_type, version, limit, force):
        return docs
    monkeypatch.setattr(gen.repo, "questions_needing_content", fake_candidates)

    async def fake_sources(settings):
        return {"grounded": _source()}
    monkeypatch.setattr(gen, "load_source_statements", fake_sources)
    seen = []

    async def fake_generate(llm, doc, settings, stamp, *, force=False, source=None, grounded_llm=None):
        seen.append((doc["slug"], source is not None))
        return "verified"
    monkeypatch.setattr(gen, "generate_one", fake_generate)
    monkeypatch.setattr(gen, "build_content_llm_client", lambda settings, **kw: _LLM({}))
    counts = asyncio.run(gen.generate_content(_settings()))
    assert seen == [("grounded", True), ("hm/x", False)] and counts["candidates"] == 2 and counts["skipped"] == 1


def test_grounded_problems_store_no_solutions_and_run_no_code(monkeypatch):
    saved = _patches(monkeypatch)

    async def must_not_run(*a, **k):
        raise AssertionError("no sandbox for grounded problems")
    monkeypatch.setattr(gen, "run_collect", must_not_run)
    content = full_dsa(judge_tests=[], approaches=[], rubric=[])
    del content["brute_force_solution"], content["reference_solution"]
    llm = _LLM({"content": content})
    assert asyncio.run(gen.generate_one(llm, _record(), _settings(), "t", source=_source())) == "verified"
    stored = saved[-1][2]["content"]
    assert stored["reference_solution"] is None and stored["brute_force_solution"] is None and stored["judge_tests"] == []
    assert [e["expected"] for e in stored["examples"]] == [3, 0] and "OMIT `reference_solution`" in llm.calls[0][1]
    # Without a source the full proof (solutions, tests, approaches, rubric) is still demanded.
    llm2 = _LLM({"content": content})
    assert asyncio.run(gen.generate_one(llm2, _record(slug="other"), _settings(), "t")) == "failed"
    assert "reference_solution" in saved[-1][2]["content_error"]


def test_dsa_without_a_validated_source_is_left_alone_by_default(monkeypatch):
    docs = [_record(slug="grounded"), _record(slug="ungrounded"), _record(slug="hm/x", round_type="hiring-manager", url="")]

    async def fake_candidates(round_type, version, limit, force):
        return docs
    monkeypatch.setattr(gen.repo, "questions_needing_content", fake_candidates)

    async def fake_sources(settings):
        return {"grounded": _source()}
    monkeypatch.setattr(gen, "load_source_statements", fake_sources)
    seen = []

    async def fake_generate(llm, doc, settings, stamp, *, force=False, source=None, grounded_llm=None):
        seen.append((doc["slug"], source is not None))
        return "verified"
    monkeypatch.setattr(gen, "generate_one", fake_generate)
    monkeypatch.setattr(gen, "build_content_llm_client", lambda settings, **kw: _LLM({}))
    counts = asyncio.run(gen.generate_content(_settings()))
    assert seen == [("grounded", True), ("hm/x", False)] and counts["candidates"] == 2 and counts["skipped"] == 1


def test_the_repository_refuses_to_save_unproven_content(monkeypatch):
    from app.db import repositories as repo
    calls = []

    class _Coll:
        async def update_one(self, *a, **k):
            calls.append(a)
    monkeypatch.setattr(repo, "get_db", lambda: {repo.INTERVIEW_QUESTIONS: _Coll()})
    save = lambda rt, status, content={"x": 1}: asyncio.run(repo.update_question_content(rt, "s", {"content": content, "content_status": status}))
    for rt, status in (("dsa", "unverified"), ("dsa", "generated"), ("dsa", "failed"), ("lld", "unverified"), ("lld", "failed")):
        with pytest.raises(repo.UnverifiedContentError):
            save(rt, status)
    assert not calls
    save("dsa", "verified"); save("lld", "generated"); save("lld", "verified")
    save("dsa", "failed", content=None)  # a failure stores no content, which is always allowed
    assert len(calls) == 4
