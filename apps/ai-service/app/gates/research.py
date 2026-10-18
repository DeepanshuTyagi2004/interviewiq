"""Research window gate: does this source window say anything about the fields we extract?"""
from __future__ import annotations

import json

from app.llm.decisions import noul
from app.research.fields import FIELD_SPECS, render_field_docs

WINDOW_QUESTIONS: dict = {
    "has_field_info": noul(
        "`text` contains at least one explicit statement about `company` that answers one of the "
        "fields described in `fields`.",
        true="`text` explicitly states something about `company` that answers a described field "
             "(for example a stated salary, a role description, a required skill or a location).",
        false="`text` has nothing relevant to the described fields: navigation, boilerplate, "
              "unrelated content, or only vague marketing with no explicit statement.",
    ),
    "about_company": noul(
        "`text` is about `company`.",
        true="`text` is about `company` (its jobs, pay, hiring, interviews, teams or products).",
        false="`text` is about something else or another organisation.",
    ),
}


def window_state(chunk_user: str) -> dict | None:
    try:
        payload = json.loads(chunk_user)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    source = payload.get("source")
    fields = payload.get("allowed_fields")
    if not isinstance(source, dict) or not isinstance(source.get("text"), str) or not isinstance(fields, list):
        return None
    docs = render_field_docs([f for f in fields if isinstance(f, str) and f in FIELD_SPECS])
    return {"company": payload.get("company"), "fields": docs,
            "title": source.get("title"), "text": source["text"]}
