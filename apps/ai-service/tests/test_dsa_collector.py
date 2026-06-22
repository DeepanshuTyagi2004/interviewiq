import asyncio
from unittest.mock import AsyncMock, patch

from app.questions.collectors.dsa import (
    leetcode_slug, parse_snehasishroy_csv, parse_neetcode, parse_kaggle,
    parse_snehasishroy_tree, collect_snehasishroy, collect_kaggle,
    parse_neetcode_md_tree, collect_neetcode,
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


# ---------------------------------------------------------------------------
# NeetCode-150 md-tree parser
# ---------------------------------------------------------------------------

_TWO_SUM_MD = b"# 1. Two Sum\nEasy\nGiven an array of integers nums...\n"
_GROUP_ANAGRAMS_MD = b"# 49. Group Anagrams\nMedium\nGiven an array of strings strs...\n"
_THREE_SUM_MD = b"# 15. 3Sum\nMedium\nGiven an integer array nums...\n"

NEETCODE_FILES: dict[str, bytes] = {
    "01. Arrays & Hashing/03.TwoSum.md": _TWO_SUM_MD,
    "01. Arrays & Hashing/04.GroupAnagrams.md": _GROUP_ANAGRAMS_MD,
    "02. Two Pointers/03.3Sum.md": _THREE_SUM_MD,
    "README.md": b"# NeetCode 150\nThis is the top-level README.",
    "01. Arrays & Hashing/subdir/README.md": b"# Nested README\nEasy\nsome content\n",
    ".github/FUNDING.yml": b"github: [dipjul]",
}


def test_parse_neetcode_md_tree_title_number_strip():
    """'# 1. Two Sum' -> title='Two Sum'"""
    recs = parse_neetcode_md_tree(NEETCODE_FILES)
    titles = [r.title for r in recs]
    assert "Two Sum" in titles


def test_parse_neetcode_md_tree_difficulty():
    """First non-empty line after H1 is 'Easy' -> difficulty='easy'"""
    recs = parse_neetcode_md_tree(NEETCODE_FILES)
    two_sum = next(r for r in recs if r.title == "Two Sum")
    assert two_sum.difficulty is not None
    assert two_sum.difficulty.value == "easy"


def test_parse_neetcode_md_tree_topic_tag_from_folder():
    """Folder '01. Arrays & Hashing' -> topic_tag='Arrays & Hashing'"""
    recs = parse_neetcode_md_tree(NEETCODE_FILES)
    two_sum = next(r for r in recs if r.title == "Two Sum")
    assert "Arrays & Hashing" in two_sum.topic_tags


def test_parse_neetcode_md_tree_slug_3sum():
    """'3Sum' -> slug='3sum' (number + letters, no hyphen)"""
    recs = parse_neetcode_md_tree(NEETCODE_FILES)
    three_sum = next(r for r in recs if r.title == "3Sum")
    assert three_sum.slug == "3sum"


def test_parse_neetcode_md_tree_excludes_readme():
    """README.md files at any level are excluded"""
    recs = parse_neetcode_md_tree(NEETCODE_FILES)
    slugs = [r.slug for r in recs]
    # The top-level README.md should produce no record
    assert len(slugs) == 3  # only the 3 problem files


def test_parse_neetcode_md_tree_excludes_github():
    """.github/ subtree is excluded"""
    recs = parse_neetcode_md_tree(NEETCODE_FILES)
    for r in recs:
        assert ".github" not in r.slug


def test_parse_neetcode_md_tree_no_statement_body():
    """QuestionRecord has no body/statement/description field storing problem text"""
    recs = parse_neetcode_md_tree(NEETCODE_FILES)
    assert len(recs) > 0
    rec = recs[0]
    # Confirm no body/statement/description fields on the record
    for field in ("body", "statement", "description", "content"):
        assert not hasattr(rec, field), f"QuestionRecord must not have field '{field}'"
    # Confirm title and url are present (not storing statement)
    assert rec.title
    assert rec.url


def test_parse_neetcode_md_tree_is_classic():
    """is_classic=True on all records"""
    recs = parse_neetcode_md_tree(NEETCODE_FILES)
    assert all(r.is_classic is True for r in recs)


def test_collect_neetcode_empty_repo_returns_empty():
    """settings.neetcode_repo='' -> collect_neetcode returns []"""
    from unittest.mock import MagicMock
    s = MagicMock()
    s.neetcode_repo = ""
    result = asyncio.run(collect_neetcode(s))
    assert result == []


def test_collect_neetcode_fetch_error_returns_empty():
    """GithubFetchError -> collect_neetcode returns [] (fail-safe)"""
    from app.questions.github import GithubFetchError
    import app.questions.collectors.dsa as dsa_mod

    async def run():
        original = dsa_mod.fetch_repo_files
        async def fake_fetch(*a, **k):
            raise GithubFetchError("404")
        dsa_mod.fetch_repo_files = fake_fetch
        try:
            from unittest.mock import MagicMock
            s = MagicMock()
            s.neetcode_repo = "dipjul/NeetCode-150"
            s.neetcode_ref = "main"
            return await collect_neetcode(s)
        finally:
            dsa_mod.fetch_repo_files = original

    assert asyncio.run(run()) == []
