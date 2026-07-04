"""Behavioural/HR collector: parsers, categorizer, vendored loader, fail-safe collectors."""
import asyncio
import pathlib
from unittest.mock import MagicMock

import app.questions.collectors.behavioural as bh
from app.models.brief import RoundType
from app.questions.collectors.behavioural import (
    _categorize,
    collect_behavioural,
    parse_rohan_behavioural,
    parse_tih_behavioural,
)
from app.questions.github import GithubFetchError

_FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "questions"
_TIH = (_FIXTURE_DIR / "tih_behavioural.md").read_text()
_ROHAN = (_FIXTURE_DIR / "rohan_behavioural.md").read_text()
# Real committed vendored seeds — resolve the data dir without needing env (no get_settings()).
_DATA_DIR = str(pathlib.Path(__file__).resolve().parents[1] / "app" / "questions" / "data")


# --- TIH parser ---

def test_tih_parses_general_and_company_sections():
    out = parse_tih_behavioural(_TIH)
    titles = {i["title"] for i in out}
    # general numbered list
    assert any("conflict with a co-worker" in t for t in titles)
    # company bullet section
    assert any("Why do you want to work for Amazon" in t for t in titles)


def test_tih_company_questions_carry_company_tag():
    out = parse_tih_behavioural(_TIH)
    amazon = next(i for i in out if "work for Amazon" in i["title"])
    assert amazon["company_tags"] == ["amazon"]
    # general questions have no company tag
    general = next(i for i in out if "conflict with a co-worker" in i["title"])
    assert general["company_tags"] == []


def test_tih_skips_frontmatter_and_source_lines():
    out = parse_tih_behavioural(_TIH)
    titles = [i["title"] for i in out]
    # frontmatter keyword lines and "Source: [Glassdoor]" notes must not become questions
    assert not any("behavioral interview software engineer" == t for t in titles)
    assert not any(t.lower().startswith("source") for t in titles)
    assert not any("glassdoor.com" in t.lower() for t in titles)


def test_tih_anchor_points_at_section():
    out = parse_tih_behavioural(_TIH)
    amazon = next(i for i in out if "work for Amazon" in i["title"])
    assert amazon["anchor"] == "#amazon-software-engineer-behavioral-interview-questions"


# --- rohan parser ---

def test_rohan_parses_bullets_under_headings():
    out = parse_rohan_behavioural(_ROHAN)
    titles = {i["title"] for i in out}
    assert len(out) >= 5
    # Amazon-section bullets get the amazon company tag
    assert any(i["company_tags"] == ["amazon"] for i in out)


def test_rohan_skips_url_only_numbered_lines():
    out = parse_rohan_behavioural(_ROHAN)
    for i in out:
        assert "http" not in i["title"].split()[0], f"URL leaked into question: {i['title']}"


# --- categorizer ---

def test_categorize_buckets():
    assert _categorize("Tell me about a time you had a conflict with a teammate") == "conflict-teamwork"
    assert _categorize("Have you ever failed at something? What did you learn?") == "failure-learning"
    assert _categorize("Tell me about a time you took a risk without approval") == "leadership-ownership"
    assert _categorize("What are your greatest strengths?") == "strengths-weaknesses"
    assert _categorize("Tell me about yourself") == "self-introduction"
    assert _categorize("What does your best day of work look like?") == "general-behavioural"


# --- vendored loader (uses the real committed JSON seeds) ---

def test_vendored_loads_amazon_and_googleyness():
    s = MagicMock()
    s.questions_data_dir = _DATA_DIR
    recs = bh._collect_vendored(s)
    assert any(r.company_tags == ["amazon"] and r.category == "amazon-lp" for r in recs)
    assert any(r.company_tags == ["google"] and r.category == "googleyness" for r in recs)
    # Amazon LP records carry the principle in topic_tags
    lp = next(r for r in recs if r.category == "amazon-lp")
    assert lp.topic_tags and lp.topic_tags[0]


# --- collect_behavioural: round type, dedupe, fail-safe ---

def _fake_files(tih_text=_TIH, rohan_text=_ROHAN):
    async def fake_fetch(owner, repo, ref, settings):
        if "handbook" in repo:
            return {bh._TIH_FILE: tih_text.encode()}
        return {bh._ROHAN_FILE: rohan_text.encode()}
    return fake_fetch


def _settings():
    s = MagicMock()
    s.tih_repo = "yangshun/tech-interview-handbook"
    s.tih_ref = "main"
    s.rohan_behavioural_repo = "rohan-paul/Awesome-JavaScript-Interviews"
    s.rohan_behavioural_ref = "master"
    s.questions_data_dir = _DATA_DIR
    return s


def test_collect_behavioural_all_behavioural_round_type(monkeypatch):
    monkeypatch.setattr(bh, "fetch_repo_files", _fake_files())
    recs = asyncio.run(collect_behavioural(_settings()))
    assert len(recs) > 50  # scraped + vendored
    assert all(r.round_type == RoundType.BEHAVIOURAL for r in recs)
    assert len({r.slug for r in recs}) == len(recs)  # no dup slugs


def test_collect_behavioural_fail_safe_when_repos_404(monkeypatch):
    async def boom(*a, **k):
        raise GithubFetchError("404")
    monkeypatch.setattr(bh, "fetch_repo_files", boom)
    # repos fail but vendored JSON still loads — never raises, never empty
    recs = asyncio.run(collect_behavioural(_settings()))
    assert len(recs) >= 50
    assert all(r.sources[0] in ("amazon-leadership-principles", "google-googleyness") for r in recs)
