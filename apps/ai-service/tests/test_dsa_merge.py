from app.questions.merge import merge_dsa
from app.questions.models import QuestionRecord
from app.models.brief import RoundType


def _q(**kw):
    base = dict(slug="two-sum", round_type=RoundType.DSA, title="Two Sum",
                url="https://leetcode.com/problems/two-sum/")
    base.update(kw)
    return QuestionRecord(**base)


def test_merge_unions_sources_companies_topics():
    a = _q(sources=["snehasishroy"], company_tags=["google"], frequency_score=0.8)
    b = _q(sources=["kaggle-leetcode"], topic_tags=["Array"], acceptance_rate=49.1, is_premium=False)
    c = _q(sources=["neetcode-150"], topic_tags=["Arrays & Hashing"], is_classic=True)
    merged = merge_dsa([[a], [b], [c]])
    assert len(merged) == 1
    m = merged[0]
    assert set(m.sources) == {"snehasishroy", "kaggle-leetcode", "neetcode-150"}
    assert m.company_tags == ["google"]
    assert set(m.topic_tags) == {"Array", "Arrays & Hashing"}
    assert m.frequency_score == 0.8 and m.acceptance_rate == 49.1
    assert m.is_premium is False and m.is_classic is True


def test_merge_keeps_distinct_slugs():
    a = _q(slug="two-sum")
    b = _q(slug="number-of-islands", url="https://leetcode.com/problems/number-of-islands/")
    assert len(merge_dsa([[a, b]])) == 2
