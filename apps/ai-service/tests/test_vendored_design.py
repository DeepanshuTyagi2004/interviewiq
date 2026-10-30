"""The committed SD/LLD seed lists load, carry reported companies only where a source names them, and stay clean."""
from unittest.mock import MagicMock

from app.models.brief import RoundType
from app.questions.collectors.vendored_design import collect_vendored_design, parse_vendored
from app.questions.quality import is_design_problem
from tests.test_behavioural_collector import _DATA_DIR


def _settings():
    s = MagicMock()
    s.questions_data_dir = _DATA_DIR
    return s


def test_committed_lists_load_without_duplicates():
    sd = collect_vendored_design(_settings(), RoundType.SYSTEM_DESIGN)
    lld = collect_vendored_design(_settings(), RoundType.LLD)
    assert len(sd) >= 80 and len(lld) >= 80
    assert all(r.round_type == RoundType.SYSTEM_DESIGN and is_design_problem(r.title) for r in sd)
    assert all(r.round_type == RoundType.LLD for r in lld)
    for recs in (sd, lld):
        assert len({r.slug for r in recs}) == len(recs)
        assert len({r.title.lower() for r in recs}) == len(recs)
        assert all(r.title.startswith("Design ") for r in recs)
        # a company tag only with a source to back it
        assert all(r.url for r in recs if r.company_tags)
        assert all(r.company_evidence == {c: "reported" for c in r.company_tags} for r in recs)
    assert any(r.company_tags == ["flipkart"] and r.is_machine_coding for r in lld)


def test_concepts_are_dropped_from_a_system_design_list():
    doc = {"source": "x", "url": "", "problems": [{"title": "Caching"}, {"title": "Design Reddit"}]}
    assert [r.title for r in parse_vendored(doc, RoundType.SYSTEM_DESIGN)] == ["Design Reddit"]
