from app.questions.parse_md import extract_md_problems


def test_extract_md_problems_basic():
    md = """
- [Two Sum](https://leetcode.com/problems/two-sum/)
- [Number of Islands](https://leetcode.com/problems/number-of-islands/)
- [Duplicate link](https://leetcode.com/problems/two-sum/)
"""
    out = extract_md_problems(md)
    assert len(out) == 2
    assert out[0]["title"] == "Two Sum"
    assert out[0]["url"] == "https://leetcode.com/problems/two-sum/"
    # duplicate URL deduplicated
    assert not any(i["url"] == "https://leetcode.com/problems/two-sum/" and out.index(i) > 0 for i in out)


def test_extract_md_problems_skips_anchors():
    md = """
- [Section](#section-anchor)
- [Real Link](https://example.com/real)
"""
    out = extract_md_problems(md)
    assert len(out) == 1
    assert out[0]["url"] == "https://example.com/real"


def test_extract_md_problems_link_filter():
    md = """
- [Problem A](https://algomaster.io/problems/a)
- [Problem B](https://youtube.com/watch?v=xyz)
"""
    out = extract_md_problems(md, link_filter="algomaster.io")
    assert len(out) == 1
    assert out[0]["title"] == "Problem A"
