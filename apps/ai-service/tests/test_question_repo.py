from app.db import repositories as repo


def test_question_key():
    doc = {"round_type": "dsa", "slug": "two-sum", "title": "Two Sum"}
    assert repo._question_key(doc) == {"round_type": "dsa", "slug": "two-sum"}


def test_question_filter_builds_mongo_query_and_lowercases():
    assert repo._question_filter(None, None, None) == {}
    assert repo._question_filter("dsa", "Google", "MEDIUM") == {
        "round_type": "dsa", "company_tags": "google", "difficulty": "medium",
    }
    # company filters on the company_tags array (Mongo matches membership); difficulty/company lowercased
    assert repo._question_filter(None, "Amazon", None) == {"company_tags": "amazon"}
