"""Self-checks for the staged-pipeline models. Run: python -m tests.test_brief_models"""
from app.models.brief import RawExperience, FinalExperience, Provenance, Geo


def test_raw_experience_geo_normalises():
    e = RawExperience.model_validate({"source": "Reddit", "geo": "India", "rounds": []})
    assert e.geo == Geo.INDIA


def test_final_round_defaults_inferred():
    fe = FinalExperience.model_validate({"rounds": [{"round_number": 1, "type": "dsa"}]})
    assert fe.rounds[0].provenance == Provenance.INFERRED
    assert fe.rounds[0].evidence_urls == []


def test_final_round_evidence_backed_with_urls():
    fe = FinalExperience.model_validate({"rounds": [
        {"round_number": 1, "type": "dsa", "provenance": "evidence_backed",
         "evidence_urls": ["https://x.com/1"]}
    ]})
    assert fe.rounds[0].provenance == Provenance.EVIDENCE_BACKED
    assert fe.rounds[0].evidence_urls == ["https://x.com/1"]


if __name__ == "__main__":
    test_raw_experience_geo_normalises()
    test_final_round_defaults_inferred()
    test_final_round_evidence_backed_with_urls()
    print("ok")
