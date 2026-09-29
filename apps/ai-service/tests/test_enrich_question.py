import asyncio
from app.prompts.enrich_question import build_enrich_prompt, ENRICH_VERSION
from app.questions.enrich import enrich_one
from app.questions.models import QuestionRecord
from app.models.brief import RoundType


def _rec():
    return QuestionRecord(slug="sdp/design-pastebin", round_type=RoundType.SYSTEM_DESIGN,
                          title="Design Pastebin", url="https://x/y", sources=["system-design-primer"])


def test_prompt_includes_title_and_round():
    p = build_enrich_prompt(_rec())
    assert "Design Pastebin" in p
    assert "system-design" in p
    assert ENRICH_VERSION  # non-empty


class _FakeLLM:
    def __init__(self, payload): self.payload = payload
    async def complete_json(self, system, user, *, label="llm"): return self.payload


def test_enrich_one_applies_fields_and_marks_enriched():
    llm = _FakeLLM({"company_tags": ["Amazon", "Flipkart"], "level_tags": ["sde2"],
                    "components_tested": ["caching", "database-design"], "estimated_duration_mins": 45})
    out = asyncio.run(enrich_one(llm, _rec()))
    assert out.enrichment_status == "enriched"
    assert out.company_tags == ["amazon", "flipkart"]
    assert out.components_tested == ["caching", "database-design"]
    assert out.estimated_duration_mins == 45


def test_enrich_one_failure_keeps_raw_record():
    class _BoomLLM:
        async def complete_json(self, *a, **k): raise RuntimeError("boom")
    out = asyncio.run(enrich_one(_BoomLLM(), _rec()))
    assert out.enrichment_status == "enrich_failed"
    assert out.company_tags == []  # unchanged
