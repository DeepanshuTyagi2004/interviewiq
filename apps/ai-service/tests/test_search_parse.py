"""Self-check for Exa /search response parsing. Run: python -m tests.test_search_parse"""
from app.exa.client import _parse_search_results


def test_parses_and_dedupes():
    data = {"results": [
        {"title": "A", "url": "https://x.com/1", "text": "full rounds text", "publishedDate": "2025-01-01"},
        {"title": "A dup", "url": "https://x.com/1", "text": "again"},
        {"title": "B", "url": "https://x.com/2", "highlights": ["h1", "h2"], "publishedDate": None},
    ]}
    out = _parse_search_results(data)
    assert [r["url"] for r in out] == ["https://x.com/1", "https://x.com/2"]
    assert out[0]["content"] == "full rounds text"   # prefers text
    assert out[0]["date"] == "2025-01-01"
    assert out[1]["content"] == "h1 … h2"            # falls back to joined highlights


if __name__ == "__main__":
    test_parses_and_dedupes()
    print("ok")
