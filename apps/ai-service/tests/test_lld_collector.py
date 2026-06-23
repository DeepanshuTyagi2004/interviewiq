import pathlib

from app.questions.collectors.lld import enumerate_prasadgujar, enumerate_grokking

_FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "questions"


def test_enumerate_prasadgujar_parses_solutions_table():
    solutions_md = """Question | Solutions | Videos
| :---:   | :-: | :-:
|Design True caller |[Solution-1](https://github.com/gopalbala/truecaller) | [Video-1](https://www.youtube.com/watch?v=3KSLh_hvwtQ)  |
|Design Snake and Ladder Game| [Solution-1](https://github.com/gopalbala/snake-and-ladder) | [Video-1](https://www.youtube.com/watch?v=5LDfqzXwxxU) |
"""
    files = {"solutions.md": solutions_md.encode()}
    out = enumerate_prasadgujar(files)
    titles = {i["title"] for i in out}
    assert any("Caller" in t or "caller" in t or "True" in t or "true" in t.lower() for t in titles) or any("Design" in t for t in titles)
    assert len(out) >= 1


def test_enumerate_grokking_finds_case_studies():
    files = {
        "docs/case-studies/design-a-parking-lot.md": b"# Parking Lot",
        "docs/case-studies/design-chess.md": b"# Chess",
        "docs/case-studies/index.md": b"# Index",
        "docs/oop-fundamentals/class-diagram.md": b"# Class",
    }
    out = enumerate_grokking(files)
    titles = {i["title"] for i in out}
    assert any("Parking" in t for t in titles)
    assert any("Chess" in t for t in titles)
    assert not any("Index" in t for t in titles)
    assert not any("Class" in t for t in titles)


def test_grokking_url_contains_filename():
    files = {"docs/case-studies/design-a-library-management-system.md": b"content"}
    out = enumerate_grokking(files)
    assert len(out) == 1
    assert "design-a-library-management-system.md" in out[0]["url"]


# ---------------------------------------------------------------------------
# Machine Coding README parser
# ---------------------------------------------------------------------------

_MACHINE_CODING_README = """
## Table of Contents

### Design Elevator
  * Problem Statement: [Problem Statement](https://github.com/lavakumarThatisetti/Machine-Coding-Round/blob/master/src/com/lavakumar/elevator/ProblemStatement.md)
  * Code : [Github](https://github.com/lavakumarThatisetti/Machine-Coding-Round/tree/master/src/com/lavakumar/elevator)
  * Video Tutorial: [YouTube](https://www.youtube.com/watch?v=xxx)

### Snake and Ladder
  * Problem Statement: [Problem Statement](https://github.com/lavakumarThatisetti/Machine-Coding-Round/blob/master/src/com/lavakumar/snakeandladder/ProblemStatement.md)
  * Code : [Github](https://github.com/lavakumarThatisetti/Machine-Coding-Round/tree/master/src/com/lavakumar/snakeandladder)
  * Video Tutorial: [YouTube](https://www.youtube.com/watch?v=yyy)

### Split Wise
  * Code : [Github](https://github.com/lavakumarThatisetti/Machine-Coding-Round/tree/master/src/com/lavakumar/splitwise)
"""


def test_parse_machine_coding_readme_title():
    from app.questions.collectors.lld import parse_machine_coding_readme
    items = parse_machine_coding_readme(_MACHINE_CODING_README)
    titles = [i["title"] for i in items]
    assert "Design Elevator" in titles
    assert "Snake and Ladder" in titles
    assert "Split Wise" in titles


def test_parse_machine_coding_readme_prefers_tree_link():
    """tree/ link wins over blob ProblemStatement link"""
    from app.questions.collectors.lld import parse_machine_coding_readme
    items = parse_machine_coding_readme(_MACHINE_CODING_README)
    elevator = next(i for i in items if i["title"] == "Design Elevator")
    assert "/tree/" in elevator["url"]
    assert "/blob/" not in elevator["url"]


def test_parse_machine_coding_readme_is_machine_coding_true():
    """Records have is_machine_coding=True"""
    import asyncio
    from unittest.mock import MagicMock
    import app.questions.collectors.lld as lld_mod

    async def run():
        original = lld_mod.fetch_repo_files
        async def fake_fetch(owner, repo, ref, settings):
            return {"README.md": _MACHINE_CODING_README.encode()}
        lld_mod.fetch_repo_files = fake_fetch
        try:
            s = MagicMock()
            s.machine_coding_repo = "lavakumarThatisetti/Machine-Coding-Round"
            s.machine_coding_ref = "master"
            return await lld_mod._collect_machine_coding(s)
        finally:
            lld_mod.fetch_repo_files = original

    results = asyncio.run(run())
    assert len(results) >= 2
    assert all(r.is_machine_coding is True for r in results)


def test_parse_machine_coding_readme_slug_prefix():
    """Records returned by _collect_machine_coding have slug starting with 'mcq/'"""
    import asyncio
    from unittest.mock import MagicMock
    import app.questions.collectors.lld as lld_mod

    async def run():
        original = lld_mod.fetch_repo_files
        async def fake_fetch(owner, repo, ref, settings):
            return {"README.md": _MACHINE_CODING_README.encode()}
        lld_mod.fetch_repo_files = fake_fetch
        try:
            s = MagicMock()
            s.machine_coding_repo = "lavakumarThatisetti/Machine-Coding-Round"
            s.machine_coding_ref = "master"
            return await lld_mod._collect_machine_coding(s)
        finally:
            lld_mod.fetch_repo_files = original

    results = asyncio.run(run())
    assert len(results) >= 2
    for r in results:
        assert r.slug.startswith("mcq/"), f"Expected slug to start with 'mcq/', got: {r.slug}"


def test_collect_machine_coding_fail_safe():
    """GithubFetchError -> returns []"""
    import asyncio
    from unittest.mock import MagicMock
    import app.questions.collectors.lld as lld_mod

    async def run():
        from app.questions.github import GithubFetchError
        original = lld_mod.fetch_repo_files
        async def fake_fetch(*a, **k):
            raise GithubFetchError("404")
        lld_mod.fetch_repo_files = fake_fetch
        try:
            s = MagicMock()
            s.machine_coding_repo = "lavakumarThatisetti/Machine-Coding-Round"
            s.machine_coding_ref = "master"
            return await lld_mod._collect_machine_coding(s)
        finally:
            lld_mod.fetch_repo_files = original

    assert asyncio.run(run()) == []


# ---------------------------------------------------------------------------
# prasadgujar per-problem URL fix (Fix 2)
# ---------------------------------------------------------------------------

def _load_lld_primer_fixture() -> dict[str, bytes]:
    """Load trimmed real solutions.md fixture into the files dict shape."""
    text = (_FIXTURE_DIR / "lld_primer_solutions.md").read_bytes()
    return {"solutions.md": text}


def test_prasadgujar_urls_are_per_problem_not_index():
    """Every problem gets a per-problem Solution url, not the index solutions.md."""
    files = _load_lld_primer_fixture()
    out = enumerate_prasadgujar(files)
    index_url = "https://github.com/prasadgujar/low-level-design-primer/blob/master/solutions.md"
    # At least some records must have a non-index url
    non_index = [i for i in out if i["url"] != index_url]
    assert len(non_index) > 0, "Expected some records to have per-problem urls"


def test_prasadgujar_distinct_problems_have_distinct_urls():
    """Distinct problems resolve to distinct urls (not all pointing to the same index)."""
    files = _load_lld_primer_fixture()
    out = enumerate_prasadgujar(files)
    assert len(out) >= 3, "Expected at least 3 problems from fixture"
    urls = [i["url"] for i in out]
    # There should be more than one distinct url across the problems
    assert len(set(urls)) > 1, "All problems pointing to the same url — per-problem fix not applied"


def test_prasadgujar_url_is_non_video():
    """Per-problem url must be a non-video link (github, blog, etc.), not youtube."""
    files = _load_lld_primer_fixture()
    out = enumerate_prasadgujar(files)
    index_url = "https://github.com/prasadgujar/low-level-design-primer/blob/master/solutions.md"
    for item in out:
        url = item["url"]
        if url == index_url:
            continue  # fallback is acceptable if no solution link at all
        assert "youtube.com" not in url and "youtu.be" not in url, (
            f"Problem '{item['title']}' has a video url: {url}"
        )


def test_prasadgujar_fallback_to_index_when_no_solution_link():
    """If a row has no Solution link at all, url falls back to the index."""
    no_solution_md = (
        "Question | Solutions | Videos\n"
        "| :---: | :-: | :-: |\n"
        "|Design Foo | - | [Video-1](https://www.youtube.com/watch?v=xxx) |\n"
    )
    files = {"solutions.md": no_solution_md.encode()}
    out = enumerate_prasadgujar(files)
    assert len(out) == 1
    index_url = "https://github.com/prasadgujar/low-level-design-primer/blob/master/solutions.md"
    assert out[0]["url"] == index_url, "Expected fallback to index url when no solution link"
