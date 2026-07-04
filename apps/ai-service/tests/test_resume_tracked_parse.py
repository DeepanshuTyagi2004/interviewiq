"""Instrumented résumé parse: the run reaches a terminal state with the right per-step statuses.

Same style as test_resume_parse: monkeypatch extract_text + build_llm_client, drive the coroutine
with asyncio.run, then inspect the run snapshot in RUNS.
"""
import asyncio

import pytest

import app.resume.tracked_parse as tp
from app.jobs.pipeline_runs import RUNS
from app.llm.client import LLMError
from app.resume.extract import ResumeExtractError


class _FakeLLM:
    def __init__(self, data, reasoning="", exc=None):
        self._data, self._reasoning, self._exc = data, reasoning, exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def complete(self, system, user, *, label="llm"):
        if self._exc:
            raise self._exc
        return self._data, self._reasoning


class _FakeSettings:
    resume_llm_model = ""
    llm_model = "gemma-3-27b-it"


def _steps(run_id):
    snap = RUNS.snapshot(run_id)
    return snap, {s["name"]: s["status"] for s in snap["steps"]}


def test_tracked_parse_happy(monkeypatch):
    monkeypatch.setattr(tp, "extract_text", lambda b: "Asha Rao\nExperience\nAcme — Intern\nBuilt X")
    data = {"full_name": "Asha Rao", "experience": [{"company": "Acme", "title": "Intern", "bullets": ["Built X"]}]}
    monkeypatch.setattr(tp, "build_llm_client", lambda s, *, model=None: _FakeLLM(data, reasoning="thinking..."))

    run_id = tp.start_resume_run("cv.pdf", 1234)
    asyncio.run(tp.run_resume_parse(b"%PDF-1.4 x", "cv.pdf", run_id, _FakeSettings()))

    snap, statuses = _steps(run_id)
    assert snap["status"] == "completed"
    assert statuses == {"received": "ok", "extract_text": "ok", "llm_request": "ok",
                        "llm_response": "ok", "validate": "ok", "done": "ok"}
    assert snap["result"]["full_name"] == "Asha Rao"
    # full-transparency detail is captured
    req = next(s for s in snap["steps"] if s["name"] == "llm_request")
    assert req["detail"]["user_prompt"] and req["detail"]["system_prompt"]
    resp = next(s for s in snap["steps"] if s["name"] == "llm_response")
    assert resp["detail"]["parsed_json"] == data
    assert resp["detail"]["reasoning"] == "thinking..."


def test_tracked_parse_extract_failure_skips_rest(monkeypatch):
    def _boom(_b):
        raise ResumeExtractError("empty file")
    monkeypatch.setattr(tp, "extract_text", _boom)

    run_id = tp.start_resume_run("cv.pdf", 10)
    asyncio.run(tp.run_resume_parse(b"", "cv.pdf", run_id, _FakeSettings()))

    snap, statuses = _steps(run_id)
    assert snap["status"] == "failed"
    assert snap["error"]["step"] == "extract_text"
    assert statuses["extract_text"] == "failed"
    assert statuses["llm_request"] == "skipped" and statuses["done"] == "skipped"


def test_tracked_parse_llm_failure_skips_validate_done(monkeypatch):
    monkeypatch.setattr(tp, "extract_text", lambda b: "text " * 20)
    monkeypatch.setattr(tp, "build_llm_client",
                        lambda s, *, model=None: _FakeLLM(None, exc=LLMError("all keys cooling")))

    run_id = tp.start_resume_run("cv.pdf", 10)
    asyncio.run(tp.run_resume_parse(b"%PDF x", "cv.pdf", run_id, _FakeSettings()))

    snap, statuses = _steps(run_id)
    assert snap["status"] == "failed"
    assert snap["error"]["step"] == "llm_response"
    assert statuses["llm_response"] == "failed"
    assert statuses["validate"] == "skipped" and statuses["done"] == "skipped"
