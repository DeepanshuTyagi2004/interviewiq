"""Self-check for Perplexity /search response parsing. Run: python -m tests.test_search_parse"""
from app.perplexity.client import _parse_search_results


def test_parses_and_dedupes():
    data = {"results": [
        {"title": "A", "url": "https://x.com/1", "snippet": "rounds...", "date": "2025-01-01"},
        {"title": "A dup", "url": "https://x.com/1", "snippet": "again"},
        {"title": "B", "url": "https://x.com/2", "content": "full text", "date": None},
    ]}
    out = _parse_search_results(data)
    assert [r["url"] for r in out] == ["https://x.com/1", "https://x.com/2"]
    assert out[0]["content"] == "rounds..."   # falls back to snippet
    assert out[1]["content"] == "full text"   # prefers content


if __name__ == "__main__":
    test_parses_and_dedupes()
    print("ok")
