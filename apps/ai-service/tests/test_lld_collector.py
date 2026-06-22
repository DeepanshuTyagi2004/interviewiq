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
