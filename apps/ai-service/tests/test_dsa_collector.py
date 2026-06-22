import asyncio
from unittest.mock import AsyncMock, patch

from app.questions.collectors.dsa import (
    leetcode_slug, parse_snehasishroy_csv, parse_neetcode, parse_kaggle,
    parse_snehasishroy_tree, collect_snehasishroy, collect_kaggle,
)


def test_leetcode_slug():
    assert leetcode_slug("https://leetcode.com/problems/number-of-islands/") == "number-of-islands"
    assert leetcode_slug("https://leetcode.com/problems/two-sum") == "two-sum"
    assert leetcode_slug("https://example.com/foo") is None


def test_parse_snehasishroy_csv_company_tag_and_metrics():
    csv_text = (
        "Difficulty,Title,Frequency,Acceptance Rate,Link\n"
        "MEDIUM,Number of Islands,0.87,56.2,https://leetcode.com/problems/number-of-islands/\n"
    )
    recs = parse_snehasishroy_csv(csv_text, "google")
    assert len(recs) == 1
    r = recs[0]
    assert r.slug == "number-of-islands"
    assert r.round_type.value == "dsa"
    assert r.company_tags == ["google"]
    assert r.difficulty.value == "medium"
    assert r.frequency_score == 0.87
    assert r.acceptance_rate == 56.2
    assert r.sources == ["snehasishroy"]


def test_collect_snehasishroy_picks_all_window():
    files = {
        "google/1. Thirty Days.csv": "Difficulty,Title,Link\nEASY,A,https://leetcode.com/problems/a/\n",
        "google/5. All.csv": "Difficulty,Title,Link\nEASY,A,https://leetcode.com/problems/a/\nHARD,B,https://leetcode.com/problems/b/\n",
        "README.md": "ignore me",
    }
    files = {k: v.encode() for k, v in files.items()}
    recs = parse_snehasishroy_tree(files)
    slugs = {r.slug for r in recs}
    assert slugs == {"a", "b"}  # used the "All" file, not the 30-day one


def test_parse_neetcode_topic_tags():
    data = [{"title": "Two Sum", "url": "https://leetcode.com/problems/two-sum/",
             "difficulty": "Easy", "pattern": "Arrays & Hashing"}]
    recs = parse_neetcode(data)
    assert recs[0].slug == "two-sum"
    assert recs[0].topic_tags == ["Arrays & Hashing"]
    assert recs[0].sources == ["neetcode-150"]


def test_parse_kaggle_premium_and_acceptance():
    csv_text = (
        "title,url,difficulty,acceptance,is_premium,related_topics\n"
        "Two Sum,https://leetcode.com/problems/two-sum/,Easy,49.1,False,Array;Hash Table\n"
    )
    recs = parse_kaggle(csv_text)
    r = recs[0]
    assert r.slug == "two-sum"
    assert r.is_premium is False
    assert r.acceptance_rate == 49.1
    assert r.topic_tags == ["Array", "Hash Table"]
    assert r.sources == ["kaggle-leetcode"]


def test_collect_snehasishroy_returns_empty_on_fetch_error():
    from app.questions.github import GithubFetchError
    import asyncio

    async def run():
        from unittest.mock import AsyncMock
        import app.questions.collectors.dsa as dsa_mod
        original = dsa_mod.fetch_repo_files
        async def fake_fetch(*a, **k):
            raise GithubFetchError("timeout")
        dsa_mod.fetch_repo_files = fake_fetch
        try:
            from unittest.mock import MagicMock
            s = MagicMock()
            return await collect_snehasishroy(s)
        finally:
            dsa_mod.fetch_repo_files = original

    result = asyncio.run(run())
    assert result == []


def test_collect_kaggle_returns_empty_when_no_csv():
    import asyncio
    import app.questions.collectors.dsa as dsa_mod

    async def run():
        from unittest.mock import MagicMock, AsyncMock
        original = dsa_mod.fetch_kaggle_csv
        async def fake_fetch(s):
            return None
        dsa_mod.fetch_kaggle_csv = fake_fetch
        try:
            s = MagicMock()
            return await collect_kaggle(s)
        finally:
            dsa_mod.fetch_kaggle_csv = original

    result = asyncio.run(run())
    assert result == []


def test_collect_kaggle_returns_records_when_csv_present():
    import asyncio
    import app.questions.collectors.dsa as dsa_mod

    csv_text = (
        "title,url,difficulty,acceptance,is_premium,related_topics\n"
        "Two Sum,https://leetcode.com/problems/two-sum/,Easy,49.1,False,Array;Hash Table\n"
    )

    async def run():
        from unittest.mock import MagicMock
        original = dsa_mod.fetch_kaggle_csv
        async def fake_fetch(s):
            return csv_text
        dsa_mod.fetch_kaggle_csv = fake_fetch
        try:
            s = MagicMock()
            return await collect_kaggle(s)
        finally:
            dsa_mod.fetch_kaggle_csv = original

    result = asyncio.run(run())
    assert len(result) == 1
    assert result[0].slug == "two-sum"
