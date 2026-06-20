"""Run: python -m tests.test_pipeline_helpers"""
from app.targets import Combination
from app.models.brief import FinalExperience, DataConfidence, GenerationStatus
from app.jobs.brief_generation import build_search_queries, derive_status, count_provenance


def test_queries_are_india_weighted():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "sde2", "backend"))
    assert all("India" in q for q in qs)
    assert any("backend" in q for q in qs)
    assert len(qs) >= 3


def test_queries_skip_general_spec():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "sde2", "general"))
    assert all("general" not in q for q in qs)


def test_status_high_when_mostly_evidence_backed():
    fe = FinalExperience.model_validate({"rounds": [
        {"round_number": i, "type": "dsa", "provenance": "evidence_backed"} for i in range(4)
    ] + [{"round_number": 5, "type": "behavioural", "provenance": "inferred"}]})
    status, conf = derive_status(fe)
    assert status == GenerationStatus.SUCCESS and conf == DataConfidence.HIGH


def test_status_low_when_mostly_inferred():
    fe = FinalExperience.model_validate({"rounds": [
        {"round_number": i, "type": "dsa", "provenance": "inferred"} for i in range(4)
    ] + [{"round_number": 5, "type": "dsa", "provenance": "evidence_backed"}]})
    status, conf = derive_status(fe)
    assert status == GenerationStatus.INSUFFICIENT_DATA and conf == DataConfidence.LOW
    assert count_provenance(fe) == (1, 4)


if __name__ == "__main__":
    test_queries_are_india_weighted()
    test_queries_skip_general_spec()
    test_status_high_when_mostly_evidence_backed()
    test_status_low_when_mostly_inferred()
    print("ok")
