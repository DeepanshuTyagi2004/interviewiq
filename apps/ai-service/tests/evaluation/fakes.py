"""Shared fixtures for the evaluation pipeline and report tests: the stored round, fake chats, an in-memory store."""
import copy
import json
from pathlib import Path

from app.evaluation import pipeline, store
from app.evaluation.models import EvaluationRunRequest, SessionMeta
from app.blueprint import store as blueprint_store

FIX = Path(__file__).parent.parent / "fixtures" / "evaluation"
DSA_KEYS = ["understanding", "approach", "code_correctness", "code_quality", "testing", "complexity", "communication"]


def load(name="dsa_round") -> dict:
    return json.loads((FIX / f"{name}.json").read_text())


def meta(**o) -> SessionMeta:
    d = dict(company="Meesho", role="SDE", level="sde1", round_type="dsa", round_minutes=45, pass_mark=6.5,
             code_standard="near_runnable", official=True)
    d.update(o)
    return SessionMeta(**d)


def request(**o) -> EvaluationRunRequest:
    d = dict(session_id="s1", candidate_id="c1", trigger="completion", meta=meta(), previous_areas={"approach": 5.9})
    d.update(o)
    return EvaluationRunRequest(**d)


def part_reply(score=7.0, must=True, logic="yes"):
    return {
        "part_id": "core-1",
        "questions": [{"id": "main", "asked": "pair sum", "answer_quotes": [{"turn_id": 7, "text": "hash map"}],
                       "verdict": "correct", "score": score, "strong_answer": "hash map one pass", "gap": "none",
                       "topics": [{"subject": "DSA", "topic": "Hash maps"}]}],
        "areas": [{"key": k, "score": score, "evidence": ["turn:7"], "reason": "r"} for k in DSA_KEYS],
        "code": {"trace": [{"example": f"e{i}", "predicted": "[0, 1]", "expected": "[0, 1]", "matches": True} for i in (1, 2)],
                 "logic_works": logic, "actual_complexity": "O(n)"},
        "events": {}, "moments": [{"turn_id": 7, "kind": "strong", "note": "found the hash map"}], "must_have_met": must,
    }


SYNTHESIS = {
    "summary": "A solid round.", "strengths": ["hash map idea"],
    "focus": [{"title": "Test before you finish", "why": "no dry run", "turn_ids": [4]}],
    "topic_gaps": [{"subject": "DSA", "topics": [{"topic": "Hash maps", "why": "needed a hint"}]}],
    "delivery": [{"text": "Fillers early on", "examples": [4]}],
    "end_questions": {"quality": "basic", "bonus": 0.0, "note": "one question"}, "interviewer_note": "fine",
}


class FakeChat:
    def __init__(self, replies):
        self.replies = replies
        self.calls = []

    async def json(self, messages, schema_name, schema, max_tokens=3000):
        self.calls.append(schema_name)
        r = self.replies[schema_name]
        if isinstance(r, Exception):
            raise r
        return copy.deepcopy(r), {}


def chats(score=7.0, must=True, logic="yes", recheck=None):
    base = {"part_grade": part_reply(score, must, logic), "round_synthesis": SYNTHESIS}
    c = {**base, **({"dispute_recheck": recheck} if recheck else {})}
    return FakeChat(base), FakeChat(base), FakeChat(c)


class Settings:
    evaluation_max_parallel_runs = 2
    evaluation_run_timeout_seconds = 30
    evaluation_run_retention_days = 30


class MemoryEvalStore:
    """The store's functions over dicts; install() patches them onto the store module."""

    def __init__(self, fixture: dict):
        self.fixture, self.runs, self.evals = fixture, {}, []

    def install(self, monkeypatch):
        async def load_live(session_id):
            return copy.deepcopy(self.fixture["run"]), copy.deepcopy(self.fixture["turns"]), copy.deepcopy(self.fixture["evidence"])

        async def current_blueprint(session_id):
            return copy.deepcopy(self.fixture["blueprint"])

        async def insert_run(doc):
            live = next((r for r in self.runs.values() if r["session_id"] == doc["session_id"] and r["status"] == "running"), None)
            if live:
                raise store.RunAlreadyActive(live["run_id"])
            self.runs[doc["run_id"]] = dict(doc)

        async def update_run(run_id, patch):
            self.runs[run_id].update(patch)

        async def finish_run(run_id, status, patch, retention_days):
            if self.runs[run_id]["status"] == "running":
                self.runs[run_id].update({**patch, "status": status})

        async def get_run(run_id, full=True):
            return self.runs.get(run_id)

        async def current_evaluation(session_id, version=None):
            rows = [e for e in self.evals if e["session_id"] == session_id and (not version or e["version"] == version)]
            return copy.deepcopy(max(rows, key=lambda e: e["version"])) if rows else None

        async def next_version(session_id):
            return max((e["version"] for e in self.evals if e["session_id"] == session_id), default=0) + 1

        async def save_evaluation(doc):
            self.evals.append(copy.deepcopy(doc))

        for fn in (load_live, insert_run, update_run, finish_run, get_run, current_evaluation, next_version, save_evaluation):
            monkeypatch.setattr(store, fn.__name__, fn)
        monkeypatch.setattr(blueprint_store, "current_blueprint", current_blueprint)
        monkeypatch.setattr(pipeline, "_SLOTS", None)

        async def no_practice(gaps, round_type, company, exclusions, per_topic=3, max_difficulty=None, fallback_topics=None, default_difficulty=None, sources=None, pool=None):
            return {t.topic: [{"slug": "two-sum", "title": "Two Sum", "difficulty": "easy"}] for g in gaps for t in g.topics}

        async def no_bank(round_type):
            return []

        monkeypatch.setattr(pipeline.practice, "suggest", no_practice)
        monkeypatch.setattr(pipeline.practice, "load_bank", no_bank)
        return self
