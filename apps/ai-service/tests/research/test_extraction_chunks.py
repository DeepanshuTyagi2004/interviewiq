"""Window coverage, source-offset grounding and safe partial extraction (no live providers)."""
import asyncio
import json

import pytest
from pydantic import ValidationError

from app.llm.client import LLMError
from app.prompts.research.evidence import build_user
from app.research.budget import BudgetExhausted
from app.research.chunks import CHUNK_VERSION, merge_claims, source_chunks
from app.research.fixtures import FixtureMissing
from app.research.models import Mode
from app.research.store import EventFilter
from tests.research.fakes import Exploding, FakeLLM
from tests.research.test_gateway import CLAIMS_KW, _io, _settings


def _user(text):
    return build_user(company="Example", source={"url": "https://example.test/careers", "title": "Careers",
                                                "content": text}, fields=("jd", "skill"))


def test_windows_cover_every_character_with_bounded_overlap_and_role_context():
    text = "## Software Engineer\nLocation: Bangalore, India\n" + "Build reliable systems.\n" * 360
    chunks = source_chunks(_user(text), chunk_chars=4500, max_chunks=4)
    assert len(chunks) == 3
    previous_end = 0
    for i, chunk in enumerate(chunks):
        data = json.loads(chunk.user)
        source = data["source"]
        context = source.get("section_context", {})
        assert source["text"] == text[chunk.start:chunk.end]
        assert len(source["text"]) + len(context.get("text", "")) <= 4500
        assert source["title"] == "Careers" and data["company"] == "Example"
        assert data["source_window"]["version"] == CHUNK_VERSION
        assert chunk.start <= previous_end
        if i:
            assert previous_end - chunk.start <= 350
            assert "Software Engineer" in context["text"]
            assert "Bangalore, India" in context["text"]
            assert context["text"] == text[context["start"]:context["end"]]
        previous_end = chunk.end
    assert chunks[0].start == 0 and chunks[-1].end == len(text)


def test_context_switches_to_the_current_role_and_does_not_invent_glue():
    text = ("## Software Engineer\nLocation: Bangalore, India\n" + "Build systems.\n" * 30
            + "## Senior Developer\nLocation: London, UK\n" + "Maintain services.\n" * 150)
    chunks = source_chunks(_user(text), chunk_chars=1000, max_chunks=6)
    context = json.loads(chunks[-1].user)["source"]["section_context"]["text"]
    assert "Senior Developer" in context and "London, UK" in context
    assert "Bangalore" not in context


def test_full_text_is_not_silently_truncated_by_prompt_builder():
    text = "evidence " * 2000
    assert json.loads(_user(text))["source"]["text"] == text


def test_oversized_source_fails_before_spending_budget(tmp_path):
    async def go():
        io, store, tracer = await _io(tmp_path, llm=Exploding())
        with pytest.raises(LLMError, match="coverage limit"):
            await io.extract_claims(**{**CLAIMS_KW, "user": _user("a" * 18000)})
        await tracer.close()
        assert (await store.get_run("run1"))["budget"]["llm_used"] == 0
    asyncio.run(go())


def test_offsets_are_absolute_and_out_of_window_offsets_remain_invalid():
    text = "A" * 950 + "TypeScript builds dependable services. " * 30
    chunk = source_chunks(_user(text), chunk_chars=1000, max_chunks=4)[1]
    source = json.loads(chunk.user)["source"]["text"]
    local = source.index("TypeScript")
    raw = {"field": "jd", "value": "TypeScript", "quote": "TypeScript",
           "value_span": {"start": local, "end": local + 10},
           "quote_span": {"start": local, "end": local + 10}}
    absolute = chunk.absolute_claim(raw)
    assert absolute["value_span"]["start"] == chunk.start + local
    assert text[absolute["quote_span"]["start"]:absolute["quote_span"]["end"]] == "TypeScript"
    assert raw["value_span"]["start"] == local
    bad = chunk.absolute_claim({**raw, "value_span": {"start": 0, "end": 1001}})
    assert bad["value_span"]["start"] < 0


def test_later_window_unicode_spans_ground_against_the_original_source():
    from app.research.nodes.evidence import Claim, ground
    from app.research.normalize.sources import classify_source

    text = "₹ café data. " * 400 + "Build dependable services in India."
    source = {"url": "https://example.test/careers", "content": text}
    chunk = source_chunks(_user(text), chunk_chars=4500, max_chunks=4)[-1]
    window = json.loads(chunk.user)["source"]["text"]
    quote = "Build dependable services in India."
    offset = window.index(quote)
    claim = chunk.absolute_claim({"field": "jd", "value": quote, "quote": quote, "geo": "IN",
                                  "quote_span": {"start": offset, "end": offset + len(quote)},
                                  "value_span": {"start": offset, "end": offset + len(quote)}})
    result = ground(Claim.model_validate(claim), source,
                    classify_source(source["url"], company_domain="example.test", company_slug="example"))
    assert result.reason is None and result.claim["value"] == quote


def test_merge_deduplicates_overlap_stably_without_discarding_different_evidence():
    a = {"field": "skill", "value": "Python", "quote": "Python required"}
    b = {**a, "quote": "Python preferred"}
    spanned = {**a, "quote_span": {"start": 10, "end": 25}}
    assert merge_claims([[a, "invalid", spanned], [dict(a), b, dict(spanned)]]) == [a, "invalid", spanned, b]


def test_chunk_failures_keep_successes_and_safe_diagnostics(tmp_path):
    async def go():
        def respond(s, u, label):
            assert "at most 24" in s and "Never guess offsets" in s
            if label.endswith("chunk-1"):
                return LLMError("private provider response should not appear in diagnostics")
            return {"claims": [{"field": "skill", "value": "Python", "quote": "Python"}]}
        llm = FakeLLM(respond)
        io, store, tracer = await _io(tmp_path, llm=llm)
        claims = await io.extract_claims(**{**CLAIMS_KW, "user": _user("Python " * 800)})
        await tracer.close()
        assert list(claims) == [{"field": "skill", "value": "Python", "quote": "Python"}]
        assert claims.diagnostics == [{"kind": "extract_chunk", "chunk_index": 0, "start": 0, "end": 4500,
                                       "error": "LLMError", "reason": "chunk_failed"}]
        events = await store.list_events("run1", EventFilter(type_prefix="research.extract.chunk_failed"))
        assert len(events) == 1 and events[0]["data"] == claims.diagnostics[0]
        assert "private" not in str(events)
    asyncio.run(go())


def test_all_failed_chunks_raise_instead_of_returning_empty_success(tmp_path):
    async def go():
        failure = LLMError("provider unavailable")
        io, _, tracer = await _io(tmp_path, llm=FakeLLM(lambda s, u, label: failure))
        with pytest.raises(LLMError) as exc:
            await io.extract_claims(**{**CLAIMS_KW, "user": _user("x" * 6000)})
        assert exc.value is failure
        await tracer.close()
    asyncio.run(go())


def test_each_chunk_gets_exactly_one_envelope_repair(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"claims": "bad"})
        io, store, tracer = await _io(tmp_path, llm=llm)
        with pytest.raises(ValidationError):
            await io.extract_claims(**{**CLAIMS_KW, "user": _user("x" * 6000)})
        await tracer.close()
        assert sorted(llm.calls) == ["t#chunk-1", "t#chunk-1#repair", "t#chunk-2", "t#chunk-2#repair"]
        assert store.extracts == {}
    asyncio.run(go())


def test_successful_empty_window_is_distinct_from_failed_window(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"claims": []} if label.endswith("chunk-2") else LLMError("unavailable"))
        io, _, tracer = await _io(tmp_path, llm=llm)
        claims = await io.extract_claims(**{**CLAIMS_KW, "user": _user("x" * 6000)})
        assert claims == [] and len(claims.diagnostics) == 1
        await tracer.close()
    asyncio.run(go())


@pytest.mark.parametrize("error", [BudgetExhausted("llm", 2, 2), FixtureMissing("missing fixture"),
                                    LLMError("HTTP 401 bad key"), asyncio.CancelledError()])
def test_control_and_configuration_errors_are_not_partial_successes(tmp_path, error):
    async def go():
        async def fail(label):
            if label.endswith("chunk-1"):
                raise error
        llm = FakeLLM(lambda s, u, label: {"claims": []}, on_call=fail)
        io, _, tracer = await _io(tmp_path, llm=llm)
        with pytest.raises(type(error)):
            await io.extract_claims(**{**CLAIMS_KW, "user": _user("x" * 6000)})
        await tracer.close()
    asyncio.run(go())


def test_chunk_record_replay_cache_and_span_translation_are_identical(tmp_path):
    async def go():
        def respond(s, u, label):
            return {"claims": [{"field": "jd", "value": label, "quote": label,
                                "quote_span": {"start": 0, "end": 1}}]}
        kw = {**CLAIMS_KW, "user": _user("x" * 6000)}
        io, store, tracer = await _io(tmp_path, mode=Mode.RECORD, llm=FakeLLM(respond))
        recorded = await io.extract_claims(**kw)
        await tracer.close()
        assert all(CHUNK_VERSION in e["prompt_version"] for e in store.extracts.values())
        assert recorded[1]["quote_span"]["start"] == 4150
        replay, replay_store, rt = await _io(tmp_path, mode=Mode.REPLAY, llm=Exploding())
        assert await replay.extract_claims(**kw) == recorded
        assert await replay.extract_claims(**kw) == recorded
        assert (await replay_store.get_run("run1"))["budget"]["llm_used"] == 0
        await rt.close()
    asyncio.run(go())


def test_arbitrary_extract_json_payloads_are_never_chunked(tmp_path):
    async def go():
        user = _user("x" * 30000)
        def respond(s, u, label):
            assert u == user and s == "s"
            return {"answer": 42}
        llm = FakeLLM(respond)
        io, _, tracer = await _io(tmp_path, llm=llm)
        assert await io.extract_json(**{**CLAIMS_KW, "user": user}) == {"answer": 42}
        assert llm.calls == ["t"]
        await tracer.close()
    asyncio.run(go())
