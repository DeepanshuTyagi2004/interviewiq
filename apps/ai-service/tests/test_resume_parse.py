"""Résumé parse: PDF-text-extraction guards, ParsedResume coercion, and the /resumes/parse route.

The route is called directly (the Depends/HTTP layer is bypassed) with a duck-typed request and a
fake LLM — same style as test_questions_endpoints. extract_text's happy path needs a real
text-bearing PDF, so here we cover its guards (the risk surface) and mock it for the route test.
"""
import asyncio

import pytest

import app.api.routes as routes
from app.models.resume import ParsedResume
from app.resume.extract import ResumeExtractError, extract_text


# --- extract_text guards ---

def test_extract_text_empty_bytes_raises():
    with pytest.raises(ResumeExtractError):
        extract_text(b"")


def test_extract_text_non_pdf_raises():
    with pytest.raises(ResumeExtractError):
        extract_text(b"this is plainly not a pdf" * 5)


def test_extract_text_password_protected_raises_clean_error():
    # A user-password-encrypted PDF: decrypt("") fails to unlock, so iterating pages raises
    # FileNotDecryptedError — which must surface as ResumeExtractError (clean 422), not escape.
    from io import BytesIO
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.encrypt("a-real-password")
    buf = BytesIO()
    writer.write(buf)

    with pytest.raises(ResumeExtractError):
        extract_text(buf.getvalue())


# --- ParsedResume tolerant coercion (the LLM output is messy) ---

def test_parsed_resume_coerces_messy_llm_output():
    parsed = ParsedResume.model_validate({
        "full_name": "  Asha Rao ",
        "email": None,
        "skills": "Python",                                       # bare string -> list
        "links": None,                                            # null -> empty object
        "education": {"institution": "IIT", "end_year": 2025},    # single object -> list; int -> str
        "experience": [
            {"company": "Acme", "title": "Intern", "bullets": "Built X"},  # bullets string -> list
            "junk-non-dict-row",                                  # dropped
        ],
    })
    assert parsed.full_name == "Asha Rao"
    assert parsed.email is None
    assert parsed.skills == ["Python"]
    assert parsed.links.github is None
    assert len(parsed.education) == 1 and parsed.education[0].end_year == "2025"
    assert len(parsed.experience) == 1 and parsed.experience[0].bullets == ["Built X"]


def test_parsed_resume_all_missing_is_valid():
    parsed = ParsedResume.model_validate({})
    assert parsed.full_name is None
    assert parsed.education == [] and parsed.experience == [] and parsed.skills == []


def test_parsed_resume_preserves_safe_links_and_drops_unsafe_values():
    parsed = ParsedResume.model_validate({
        "portfolio_website": "example.com/me",
        "links": {"github": "https://github.com/asha", "portfolio_website": "javascript:alert(1)"},
        "experience": [{"company": "Acme", "url": "https://acme.example/work"}],
        "projects": [{"name": "Demo", "link": "file:///tmp/demo"}],
    })
    assert parsed.portfolio_website == "https://example.com/me"
    assert parsed.links.github == "https://github.com/asha"
    assert parsed.links.portfolio_website is None
    assert parsed.experience[0].link == "https://acme.example/work"
    assert parsed.projects[0].link is None


# --- /resumes/parse route ---

class _FakeRequest:
    def __init__(self, body: bytes):
        self._body = body

    async def body(self) -> bytes:
        return self._body


class _FakeLLM:
    def __init__(self, data):
        self._data = data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def complete_json(self, system, user, *, label="llm"):
        return self._data


class _FakeSettings:
    resume_llm_model = ""
    llm_model = "gemma-3-27b-it"


def test_parse_resume_route_happy(monkeypatch):
    monkeypatch.setattr(routes, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(routes, "extract_text", lambda b: "Asha Rao\nPython, SQL")
    llm_out = {"full_name": "Asha Rao", "skills": ["Python", "SQL"]}
    monkeypatch.setattr(routes, "build_resume_llm_client", lambda settings: _FakeLLM(llm_out))
    result = asyncio.run(routes.parse_resume(_FakeRequest(b"%PDF-1.4 fake")))
    assert result["full_name"] == "Asha Rao"
    assert result["skills"] == ["Python", "SQL"]
    assert "education" in result and "links" in result   # full ParsedResume dump shape


def test_parse_resume_route_oversize_413():
    from fastapi import HTTPException
    big = b"x" * (routes._MAX_RESUME_BYTES + 1)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(routes.parse_resume(_FakeRequest(big)))
    assert ei.value.status_code == 413


def test_parse_resume_route_unreadable_422(monkeypatch):
    from fastapi import HTTPException

    def _boom(_b):
        raise ResumeExtractError("image-only")

    monkeypatch.setattr(routes, "extract_text", _boom)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(routes.parse_resume(_FakeRequest(b"%PDF-1.4")))
    assert ei.value.status_code == 422
