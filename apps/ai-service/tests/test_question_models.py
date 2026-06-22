from app.questions.models import QuestionRecord
from app.models.brief import RoundType, Difficulty


def test_minimal_dsa_record_defaults():
    q = QuestionRecord(slug="two-sum", round_type=RoundType.DSA, title="Two Sum",
                       url="https://leetcode.com/problems/two-sum/")
    assert q.round_type == RoundType.DSA
    assert q.sources == [] and q.topic_tags == [] and q.company_tags == []
    assert q.enrichment_status == "raw"
    assert q.is_machine_coding is None  # lld-only field, unset for dsa


def test_string_list_coercion_and_difficulty():
    q = QuestionRecord(slug="x", round_type="system-design", title="t", url="u",
                       topic_tags="hashing", difficulty="MEDIUM", company_tags=["Google", None, "amazon"])
    assert q.topic_tags == ["hashing"]
    assert q.difficulty == Difficulty.MEDIUM
    assert q.company_tags == ["google", "amazon"]  # lowercased, None dropped


def test_evaluation_mode_optional():
    q = QuestionRecord(slug="x", round_type="lld", title="t", url="u",
                       is_machine_coding=True, evaluation_mode="working-code", assess=["extensibility"])
    assert q.is_machine_coding is True
    assert q.evaluation_mode == "working-code"


def test_source_hash_field_defaults_none():
    q = QuestionRecord(slug="x", round_type="dsa", title="t", url="u")
    assert q.source_hash is None
