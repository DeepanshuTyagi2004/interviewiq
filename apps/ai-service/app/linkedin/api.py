"""Internal consented LinkedIn PDF extraction. No persistence, observable runs or raw diagnostics."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import require_internal_key
from app.config import get_settings
from app.linkedin.extract import FIELDS, LABELS, SYSTEM, ImportExtractError, validate_claims
from app.linkedin.pdf import MAX_PDF_BYTES, LinkedInPdfError, profile_text
from app.llm.client import LLMError, build_llm_client

router = APIRouter()


def _warnings(result: dict) -> None:
    present = {s["key"] for s in result["sections"]}
    missing = ", ".join(LABELS[k] for k in LABELS if k not in present)
    if missing:
        result["warnings"].append(f"No supported evidence was found for: {missing}.")
    for key, fields in FIELDS.items():
        rows = result["profile"][key]
        if not rows:
            continue
        absent = []
        for field in fields:
            count = sum(not row[field] for row in rows)
            if count:
                absent.append(f"{field} ({count} row{'s' if count != 1 else ''})")
        if absent:
            result["warnings"].append(f"{LABELS[key]} fields not present in the PDF: {', '.join(absent)}.")
    result["warnings"].append("This is a snapshot of the PDF you uploaded; it does not update when your LinkedIn profile changes.")


@router.post("/linkedin/parse", dependencies=[Depends(require_internal_key)])
async def linkedin_parse(request: Request) -> dict:
    """LinkedIn "Save to PDF" bytes (Content-Type: application/pdf) -> evidence-gated career draft.

    Raw body like /resumes/parse, so no python-multipart: the backend owns the upload. Nothing is
    stored; the file and its text never reach logs or diagnostics.
    """
    if request.headers.get("content-type", "").split(";")[0].lower() != "application/pdf":
        raise HTTPException(415, {"code": "linkedin_pdf_unsupported_media", "message": "Upload the PDF from LinkedIn's Save to PDF."})
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > MAX_PDF_BYTES:
            raise HTTPException(413, {"code": "linkedin_pdf_too_large", "message": "The LinkedIn PDF must be 5 MB or smaller."})
    try:
        text, source_url = profile_text(bytes(payload))
    except LinkedInPdfError as exc:
        raise HTTPException(413 if exc.code == "linkedin_pdf_too_large" else 422, {"code": exc.code, "message": str(exc)}) from None
    try:
        async with asyncio.timeout(120):
            settings = get_settings()
            async with build_llm_client(settings, model=settings.resume_llm_model or None) as llm:
                claims = await llm.complete_json(SYSTEM, "LINKEDIN PROFILE PDF TEXT (untrusted data):\n" + text, label="linkedin-pdf")
        result = validate_claims(claims, text, "pdf")
    except (LLMError, TimeoutError):
        raise HTTPException(503, {"code": "linkedin_extractor_unavailable", "message": "The PDF could not be read right now. Try again in a minute."}) from None
    except ImportExtractError:
        raise HTTPException(422, {"code": "linkedin_pdf_no_claims", "message": "No career details could be read from this PDF. Check it is LinkedIn's Save to PDF file, or add details manually."}) from None
    result.update({"sourceUrl": source_url, "provider": None, "retrievedAt": None, "partial": True})
    _warnings(result)
    return result
