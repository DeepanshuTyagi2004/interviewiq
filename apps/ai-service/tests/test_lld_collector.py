from app.questions.collectors.lld import enumerate_prasadgujar, enumerate_grokking


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
