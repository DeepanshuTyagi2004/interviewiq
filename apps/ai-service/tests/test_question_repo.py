from app.db import repositories as repo


def test_question_key():
    doc = {"round_type": "dsa", "slug": "two-sum", "title": "Two Sum"}
    assert repo._question_key(doc) == {"round_type": "dsa", "slug": "two-sum"}
