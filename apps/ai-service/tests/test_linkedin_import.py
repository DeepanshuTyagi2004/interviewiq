"""Offline LinkedIn PDF extraction tests. No LLM, DB, network or member profile data."""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

import app.api.deps as deps
import app.linkedin.api as api
from app.linkedin.extract import ImportExtractError, validate_claims
from app.linkedin.pdf import MAX_PDF_BYTES, LinkedInPdfError, profile_text
from app.linkedin.url import canonical_profile_url
from app.llm.client import LLMClient, LLMError

URL = "https://www.linkedin.com/in/example-engineer/"
# The shape of LinkedIn's "Save to PDF": sidebar contact block (slug wrapped before "(LinkedIn)"),
# top skills and honors, then the main column, with a page footer.
LINES = [
    "Contact", "example@example.com", "www.linkedin.com/in/example-", "engineer (LinkedIn)",
    "Top Skills", "Python", "SQL",
    "Honors-Awards", "Smart India Hackathon 2024 finalist",
    "Example Engineer", "Software engineer", "Pune, Maharashtra, India",
    "Summary", "Builds developer tools and maintains self-reported professional information.",
    "Experience", "Example Co", "Engineer", "June 2024 - Present (1 year 4 months)",
    "Built tools and improved developer", "workflows for the platform team.",
    "Education", "Example University", "Bachelor of Technology - BTech, Computer Science (2020 - 2024)",
    "Page 1 of 1",
]
CLAIMS = {"claims": [
    {"section": "headline", "path": "profile.headline", "value": "Software engineer", "quote": "Software engineer"},
    {"section": "about", "path": "profile.about", "value": "Builds developer tools", "quote": "Builds developer tools"},
    {"section": "experience", "path": "profile.experience.0.company", "value": "Example Co", "quote": "Example Co"},
    {"section": "experience", "path": "profile.experience.0.title", "value": "Engineer", "quote": "Engineer"},
    # Spans a wrapped PDF line: the evidence gate compares collapsed whitespace.
    {"section": "experience", "path": "profile.experience.0.bullets.0", "value": "Built tools and improved developer workflows",
     "quote": "Built tools and improved developer workflows for the platform team."},
    {"section": "skills", "path": "profile.skills.0", "value": "Python", "quote": "Python"},
    {"section": "achievements", "path": "profile.achievements.0", "value": "Smart India Hackathon 2024 finalist", "quote": "Smart India Hackathon 2024 finalist"},
]}


def make_pdf(lines: list[str]) -> bytes:
    """A minimal single-page text PDF (Helvetica, one line per entry) that pypdf can read."""
    ops = ["BT", "/F1 10 Tf", "12 TL", "40 800 Td"]
    for line in lines:
        ops.append("(" + line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ") Tj T*")
    ops.append("ET")
    stream = "\n".join(ops).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


PDF = make_pdf(LINES)


class FakeLLM:
    def __init__(self, data=CLAIMS, error=None):
        self.data = data
        self.error = error
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def complete_json(self, system, user, **kwargs):
        self.calls.append((system, user, kwargs))
        if self.error:
            raise self.error
        return self.data


def setup_app(monkeypatch, llm=None):
    settings = SimpleNamespace(internal_api_key="test-internal-key", resume_llm_model="", llm_model="fake")
    monkeypatch.setattr(deps, "get_settings", lambda: settings)
    monkeypatch.setattr(api, "get_settings", lambda: settings)
    llm = llm or FakeLLM()
    build_options = []

    def build(_settings, **kwargs):
        build_options.append(kwargs)
        return llm

    monkeypatch.setattr(api, "build_llm_client", build)
    app = FastAPI()
    app.include_router(api.router)
    return app, llm, build_options


def request(app, content=PDF, key="test-internal-key", content_type="application/pdf"):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://offline.test") as client:
            return await client.post("/linkedin/parse", content=content,
                                     headers={"X-Internal-Api-Key": key, "Content-Type": content_type})
    return asyncio.run(run())


def test_profile_text_reads_export_redacts_contacts_and_finds_wrapped_profile_url():
    text, source_url = profile_text(PDF)
    assert source_url == URL
    assert "Page 1 of 1" not in text
    assert "example@example.com" not in text and "[email]" in text
    assert "Software engineer" in text and "Smart India Hackathon 2024 finalist" in text


@pytest.mark.parametrize("lines", [
    # A resume that links to LinkedIn has neither the "(LinkedIn)" contact marker nor page footers.
    ["Example Engineer", "linkedin.com/in/example-engineer", "Experience", "Engineer at Example Co, 2024 to Present."] * 8,
    # A LinkedIn-like layout without any member profile link.
    ["Contact", "Experience", "Example Co", "Engineer", "Education", "Example University"] * 8 + ["Page 1 of 1"],
])
def test_files_that_are_not_linkedin_exports_are_unrecognized(lines):
    with pytest.raises(LinkedInPdfError) as caught:
        profile_text(make_pdf(lines))
    assert caught.value.code == "linkedin_pdf_unrecognized"


@pytest.mark.parametrize("content,code", [
    (b"not a pdf at all", "linkedin_pdf_unreadable"),
    (b"%PDF-1.4\ncorrupt body", "linkedin_pdf_unreadable"),
    (make_pdf(["Page 1 of 1"]), "linkedin_pdf_unreadable"),
    (b"%PDF-" + b"0" * MAX_PDF_BYTES, "linkedin_pdf_too_large"),
])
def test_unreadable_and_oversize_files_fail_with_constant_codes(content, code):
    with pytest.raises(LinkedInPdfError) as caught:
        profile_text(content)
    assert caught.value.code == code


def test_parse_returns_evidence_gated_pdf_draft_without_contacts(monkeypatch):
    app, llm, options = setup_app(monkeypatch)
    response = request(app)
    assert response.status_code == 200
    data = response.json()
    assert options == [{"model": None}]
    assert len(llm.calls) == 1 and "example@example.com" not in llm.calls[0][1]
    assert data["method"] == "pdf" and data["sourceUrl"] == URL
    assert data["provider"] is None and data["retrievedAt"] is None and data["partial"] is True
    assert data["profile"]["headline"] == "Software engineer" and data["profile"]["skills"] == ["Python"]
    assert data["profile"]["achievements"] == ["Smart India Hackathon 2024 finalist"]
    assert data["profile"]["experience"][0]["bullets"] == ["Built tools and improved developer workflows"]
    assert "level" not in data["profile"] and "fullName" not in data["profile"]
    assert all(p["file"] is None for p in data["provenance"])
    assert any("snapshot of the PDF" in warning for warning in data["warnings"])
    assert any("Education" in warning and "No supported evidence" in warning for warning in data["warnings"])
    assert any("Experience fields" in warning and "startDate" in warning for warning in data["warnings"])


def test_internal_auth_runs_before_reading_the_file(monkeypatch):
    app, llm, _ = setup_app(monkeypatch)
    for key in ("", "wrong"):
        assert request(app, key=key).status_code == 401
    assert llm.calls == []
    monkeypatch.setattr(deps, "get_settings", lambda: SimpleNamespace(internal_api_key=""))
    assert request(app, key="").status_code == 401


def test_parse_rejects_other_media_oversize_and_non_linkedin_files_without_llm_calls(monkeypatch):
    app, llm, _ = setup_app(monkeypatch)
    for content_type in ("application/json", "multipart/form-data", "application/zip", "text/plain"):
        assert request(app, content_type=content_type).status_code == 415
    assert request(app, content=b"%PDF-" + b"0" * MAX_PDF_BYTES).status_code == 413
    resume = request(app, content=make_pdf(["Example Engineer", "linkedin.com/in/example-engineer", "Experience at Example Co."] * 10))
    assert resume.status_code == 422 and resume.json()["detail"]["code"] == "linkedin_pdf_unrecognized"
    unreadable = request(app, content=b"%PDF-1.4\ncorrupt body")
    assert unreadable.status_code == 422 and unreadable.json()["detail"]["code"] == "linkedin_pdf_unreadable"
    assert llm.calls == []


@pytest.mark.parametrize("llm,status,code", [
    (FakeLLM(error=LLMError("private provider body")), 503, "linkedin_extractor_unavailable"),
    (FakeLLM(data={"claims": [{"section": "skills", "path": "profile.skills.0", "value": "Rust", "quote": "Rust"}]}), 422, "linkedin_pdf_no_claims"),
    (FakeLLM(data={"unexpected": True}), 422, "linkedin_pdf_no_claims"),
])
def test_extractor_failures_are_actionable_without_payloads(monkeypatch, llm, status, code):
    app, _, _ = setup_app(monkeypatch, llm=llm)
    response = request(app)
    assert response.status_code == status and response.json()["detail"]["code"] == code
    assert "private" not in response.text and "Example Co" not in response.text


def test_false_claims_unknown_fields_and_empty_results_never_make_successful_import():
    text, _ = profile_text(PDF)
    invalid_claims = {"claims": CLAIMS["claims"] + [
        {"section": "skills", "path": "profile.skills.1", "value": "Rust", "quote": "Python"},
        {"section": "level", "path": "profile.level", "value": "principal", "quote": "principal"},
        {"section": "experience", "path": "profile.experience.0.verified", "value": "Engineer", "quote": "Engineer"},
        {"section": "skills", "path": "profile.skills.2", "value": "Python", "quote": "fake source"},
    ]}
    result = validate_claims(invalid_claims, text, "pdf")
    assert result["method"] == "pdf" and result["profile"]["skills"] == ["Python"]
    assert "verified" not in json.dumps(result["profile"]) and "level" not in result["profile"]
    assert any("discarded" in w for w in result["warnings"])
    for data in ({"claims": [], "verified": True}, {"claims": []}, {"claims": [{"section": "skills", "path": "profile.skills.0", "value": "Rust", "quote": "Rust"}]}):
        with pytest.raises(ImportExtractError):
            validate_claims(data, text, "pdf")


def test_provenance_paths_follow_canonical_arrays_and_discard_conflicting_scalar_values():
    text, _ = profile_text(PDF)
    claims = {"claims": [
        {"section": "experience", "path": "profile.experience.7.company", "value": "Example Co", "quote": "Example Co"},
        {"section": "experience", "path": "profile.experience.7.title", "value": "Engineer", "quote": "Engineer"},
        {"section": "experience", "path": "profile.experience.7.title", "value": "Example Co", "quote": "Example Co"},
        {"section": "experience", "path": "profile.experience.7.bullets.9", "value": "Built tools", "quote": "Built tools"},
        {"section": "skills", "path": "profile.skills.9", "value": "Python", "quote": "Python"},
        {"section": "skills", "path": "profile.skills.8", "value": "Python", "quote": "Python"},
        {"section": "courses", "path": "sections.courses.9", "value": "Computer Science", "quote": "Computer Science"},
    ]}
    result = validate_claims(claims, text, "pdf")
    assert result["profile"]["experience"][0]["title"] == "Engineer"
    paths = {p["path"] for p in result["provenance"]}
    assert paths == {"profile.experience.0.company", "profile.experience.0.title", "profile.experience.0.bullets.0", "profile.skills.0", "sections.courses.0"}
    assert any("discarded" in w for w in result["warnings"])


@pytest.mark.parametrize("invalid", [
    "http://www.linkedin.com/in/example/", "https://www.linkedin.com.evil.test/in/example/",
    "https://www.linkedin.com@evil.test/in/example/", "https://user@www.linkedin.com/in/example/",
    "https://www.linkedin.com:443/in/example/", "https://in.linkedin.com/in/example/",
    "https://www.linkedin.com/company/example/", "https://www.linkedin.com/in/../example",
    "https://www.linkedin.com/in/example%2fother", "https://www.linkedin.com/in/example\\other",
    "https://www.linkedin.com/in//example/", "https://www.linkedin.com/in/example\n",
])
def test_profile_link_normalizer_rejects_unsafe_urls(invalid):
    with pytest.raises(ValueError):
        canonical_profile_url(invalid)
