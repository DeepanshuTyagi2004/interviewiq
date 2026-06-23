import inspect
from pathlib import Path

from app.questions.collectors.system_design import (
    enumerate_donnemartin, _parse_karan_readme, _parse_ashish_readme,
    _parse_interviewready_readme,
    collect_system_design,
)
import app.questions.collectors.system_design as sd_mod

_FIXTURES = Path(__file__).parent / "fixtures" / "questions"


def test_enumerate_donnemartin_finds_problems_skips_template():
    files = {
        "solutions/system_design/mint/README.md": b"# Mint\nContent",
        "solutions/system_design/pastebin/README.md": b"# Pastebin\nContent",
        "solutions/system_design/template/README.md": b"# Template\nContent",
        "solutions/system_design/mint/mint.py": b"code",
    }
    out = enumerate_donnemartin(files)
    titles = {i["title"] for i in out}
    assert "Mint" in titles
    assert "Pastebin" in titles
    assert "Template" not in titles


def test_enumerate_donnemartin_url_contains_name():
    files = {"solutions/system_design/query_cache/README.md": b"content"}
    out = enumerate_donnemartin(files)
    assert len(out) == 1
    assert "query_cache" in out[0]["url"]


def test_parse_karan_readme_extracts_chapter_v_problems():
    md = """
- **Chapter V**

  - [URL Shortener](#url-shortener)
  - [WhatsApp](#whatsapp)
  - [Twitter](#twitter)
  - [Netflix](#netflix)
  - [Uber](#uber)

- **Appendix**
"""
    out = _parse_karan_readme(md)
    titles = {i["title"] for i in out}
    assert "URL Shortener" in titles
    assert "WhatsApp" in titles
    assert len(out) == 5


def test_parse_ashish_readme_extracts_problems():
    md = """## 💻 System Design Interview Problems
### Easy
- [Design URL Shortener like TinyURL](https://algomaster.io/learn/system-design-interviews/design-url-shortener)
- [Design WhatsApp](https://algomaster.io/learn/system-design-interviews/design-whatsapp)
"""
    out = _parse_ashish_readme(md)
    assert len(out) >= 2
    assert any("URL Shortener" in i["title"] for i in out)


def test_interviewready_in_repo_list():
    """InterviewReady IS fetched — _collect_interviewready function must exist on the module."""
    assert hasattr(sd_mod, "_collect_interviewready"), (
        "_collect_interviewready must exist (github-linked repo)"
    )
    assert hasattr(sd_mod, "_parse_interviewready_readme"), (
        "_parse_interviewready_readme must exist"
    )


def test_interviewready_in_prefix_map():
    """interviewready key is present in the _PREFIX slug map."""
    assert "interviewready" in sd_mod._PREFIX
    assert sd_mod._PREFIX["interviewready"] == "irsd"


def test_parse_interviewready_readme_from_fixture():
    """Parser produces per-problem README-anchor urls from the sd_interviewready fixture."""
    text = (_FIXTURES / "sd_interviewready.md").read_text()
    out = _parse_interviewready_readme(text)
    assert len(out) >= 2, "Expected at least 2 problems from fixture"
    for item in out:
        assert "README.md#" in item["url"], f"Expected README anchor url, got: {item['url']}"
        assert item["title"]


def test_parse_interviewready_readme_anchors():
    """URLs are fetchable GitHub content anchors, not video links."""
    text = "## Video Processing\n\n## Rate Limiting\n"
    out = _parse_interviewready_readme(text)
    assert len(out) == 2
    assert all("README.md#" in i["url"] for i in out)
    assert all("youtube" not in i["url"] for i in out)
    titles = {i["title"] for i in out}
    assert "Video Processing" in titles
    assert "Rate Limiting" in titles


# ---------------------------------------------------------------------------
# SD prefer non-video link (Fix 3b)
# ---------------------------------------------------------------------------

def test_parse_ashish_readme_prefers_article_over_video():
    """When a problem line has both an article and a video link, article wins."""
    md = (
        "## 💻 System Design Interview Problems\n"
        "### Easy\n"
        "- [Design URL Shortener](https://algomaster.io/design-url-shortener) "
        "[Watch](https://www.youtube.com/watch?v=abc123)\n"
        "- [Design Uber](https://www.youtube.com/watch?v=umWABit-wbk)\n"
    )
    out = _parse_ashish_readme(md)
    url_shortener = next((i for i in out if "URL Shortener" in i["title"]), None)
    assert url_shortener is not None
    assert "youtube.com" not in url_shortener["url"], (
        "Expected article url to be preferred over youtube for URL Shortener"
    )
    assert "algomaster.io" in url_shortener["url"]


def test_parse_ashish_readme_skips_video_only_entries():
    """When a problem has ONLY a video link, the entry is skipped entirely (not emitted)."""
    md = (
        "## 💻 System Design Interview Problems\n"
        "### Hard\n"
        "- [Design Uber](https://www.youtube.com/watch?v=umWABit-wbk)\n"
    )
    out = _parse_ashish_readme(md)
    assert len(out) == 0, "Video-only entries must be skipped, not emitted"


def test_parse_ashish_readme_mixed_video_and_article():
    """Fixture with video-only + article-only + mixed entries: only article-linked ones survive."""
    md = (
        "## 💻 System Design Interview Problems\n"
        "### Easy\n"
        "- [Design URL Shortener](https://algomaster.io/design-url-shortener) "
        "[Watch](https://www.youtube.com/watch?v=abc123)\n"
        "- [Design YouTube](https://www.youtube.com/watch?v=K-j8FoicR3E)\n"
        "- [Design Twitter](https://algomaster.io/design-twitter)\n"
    )
    out = _parse_ashish_readme(md)
    titles = {i["title"] for i in out}
    assert "Design URL Shortener" in titles, "Mixed entry should survive with article url"
    assert "Design YouTube" not in titles, "Video-only entry must be skipped"
    assert "Design Twitter" in titles
    assert len(out) == 2
    # Verify no youtube urls remain in any emitted record
    for item in out:
        assert "youtube.com" not in item["url"]
        assert "youtu.be" not in item["url"]
