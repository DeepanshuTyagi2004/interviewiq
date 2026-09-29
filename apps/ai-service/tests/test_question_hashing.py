from app.questions.hashing import compute_source_hash
from app.questions.models import QuestionRecord
from app.models.brief import RoundType


def _base() -> QuestionRecord:
    return QuestionRecord(slug="two-sum", round_type=RoundType.DSA, title="Two Sum",
                          url="https://leetcode.com/problems/two-sum/",
                          topic_tags=["Array", "Hash Table"])


def test_same_source_fields_same_hash():
    r1 = _base()
    r2 = _base()
    assert compute_source_hash(r1) == compute_source_hash(r2)


def test_tag_order_does_not_matter():
    r1 = _base()
    r2 = QuestionRecord(slug="two-sum", round_type=RoundType.DSA, title="Two Sum",
                        url="https://leetcode.com/problems/two-sum/",
                        topic_tags=["Hash Table", "Array"])
    assert compute_source_hash(r1) == compute_source_hash(r2)


def test_title_change_changes_hash():
    r1 = _base()
    r2 = _base().model_copy(update={"title": "Three Sum"})
    assert compute_source_hash(r1) != compute_source_hash(r2)


def test_company_tag_change_changes_hash():
    r1 = _base()
    r2 = QuestionRecord(slug="two-sum", round_type=RoundType.DSA, title="Two Sum",
                        url="https://leetcode.com/problems/two-sum/",
                        topic_tags=["Array", "Hash Table"], company_tags=["google"])
    assert compute_source_hash(r1) != compute_source_hash(r2)


def test_enriched_field_change_does_not_change_hash():
    r1 = _base()
    r2 = r1.model_copy(update={"patterns_tested": ["sliding-window"], "enrichment_status": "enriched"})
    assert compute_source_hash(r1) == compute_source_hash(r2)


def test_hash_starts_with_sha256():
    r = _base()
    assert compute_source_hash(r).startswith("sha256:")
