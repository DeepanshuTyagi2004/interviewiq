"""Run: python -m tests.test_pipeline_helpers"""
from app.targets import Combination
from app.models.brief import FinalExperience, RawExperience, DataConfidence, GenerationStatus
from app.jobs.brief_generation import (
    build_search_queries, derive_status, count_provenance, count_strong_rounds,
    _level_bucket, _level_matches,
)


def _fe(rounds):
    return FinalExperience.model_validate({"rounds": rounds})


def _raw(url, level):
    return RawExperience.model_validate(
        {"url": url, "detected_level": level, "rounds": [{"round_number": 1, "type": "dsa"}]})


def test_queries_are_india_weighted_and_carry_level():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "sde2", "backend"))
    assert all("India" in q for q in qs)
    assert all("backend" in q and "sde2" in q for q in qs)   # every variant carries spec+level now
    assert len(qs) == 3


def test_queries_skip_general_spec():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "sde2", "general"))
    assert all("general" not in q for q in qs)


def test_level_bucket_and_match():
    assert _level_bucket("sde2") == "mid"
    assert _level_bucket("Senior Software Engineer") == "senior"
    assert _level_bucket("intern") == "fresher"
    assert _level_bucket("4 years experience") == "senior"
    assert _level_bucket(None) == "unknown"
    assert _level_matches("fresher", "intern") is True       # same family
    assert _level_matches("fresher", "sde2") is False        # cross-level
    assert _level_matches("fresher", None) is True           # unknown -> benefit of the doubt


def test_high_when_level_matched_evidence():
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u1"]} for i in range(1, 5)]
             + [{"round_number": 5, "type": "behavioural", "provenance": "inferred"}])
    status, conf = derive_status(fe, [_raw("u1", "fresher")], "fresher")
    assert status == GenerationStatus.SUCCESS and conf == DataConfidence.HIGH
    assert count_strong_rounds(fe, [_raw("u1", "fresher")], "fresher") == 4


def test_offlevel_only_evidence_does_not_count():
    # 4 evidence_backed rounds, but every cited source is sde2 under a fresher combo -> not strong -> low
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u2"]} for i in range(1, 5)])
    status, conf = derive_status(fe, [_raw("u2", "sde2")], "fresher")
    assert status == GenerationStatus.INSUFFICIENT_DATA and conf == DataConfidence.LOW
    assert count_provenance(fe) == (4, 0)   # provenance still counts them as evidence_backed


def test_unknown_level_source_counts_as_match():
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u3"]} for i in range(1, 5)])
    _, conf = derive_status(fe, [_raw("u3", None)], "fresher")
    assert conf == DataConfidence.HIGH


def test_empty_rounds_is_insufficient():
    status, conf = derive_status(_fe([]), [], "fresher")
    assert status == GenerationStatus.INSUFFICIENT_DATA and conf == DataConfidence.LOW


if __name__ == "__main__":
    test_queries_are_india_weighted_and_carry_level()
    test_queries_skip_general_spec()
    test_level_bucket_and_match()
    test_high_when_level_matched_evidence()
    test_offlevel_only_evidence_does_not_count()
    test_unknown_level_source_counts_as_match()
    test_empty_rounds_is_insufficient()
    print("ok")
