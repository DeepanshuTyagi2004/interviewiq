import inspect

from app.questions.collectors.system_design import (
    enumerate_donnemartin, _parse_karan_readme, _parse_ashish_readme,
    collect_system_design,
)
import app.questions.collectors.system_design as sd_mod


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


def test_interviewready_not_in_repo_list():
    """InterviewReady is not fetched — _collect_interviewready function is gone."""
    # The fetcher function must not exist on the module
    assert not hasattr(sd_mod, "_collect_interviewready"), (
        "_collect_interviewready should be removed (video-only repo)"
    )
    assert not hasattr(sd_mod, "_parse_interviewready_readme"), (
        "_parse_interviewready_readme should be removed (video-only repo)"
    )


def test_interviewready_not_in_prefix_map():
    """interviewready key is gone from the _PREFIX slug map."""
    assert "interviewready" not in sd_mod._PREFIX


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


def test_parse_ashish_readme_falls_back_to_video_when_only_video():
    """When a problem has ONLY a video link, that video url is still returned (fallback)."""
    md = (
        "## 💻 System Design Interview Problems\n"
        "### Hard\n"
        "- [Design Uber](https://www.youtube.com/watch?v=umWABit-wbk)\n"
    )
    out = _parse_ashish_readme(md)
    assert len(out) == 1
    assert "youtube.com" in out[0]["url"]
