from app.questions.collectors.system_design import (
    enumerate_donnemartin, _parse_karan_readme, _parse_ashish_readme, _parse_interviewready_readme
)


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


def test_parse_interviewready_readme_extracts_headings():
    md = """## Video Processing
## Rate Limiting
## Service Mesh
"""
    out = _parse_interviewready_readme(md)
    titles = {i["title"] for i in out}
    assert "Video Processing" in titles
    assert "Rate Limiting" in titles
    assert "Service Mesh" in titles
