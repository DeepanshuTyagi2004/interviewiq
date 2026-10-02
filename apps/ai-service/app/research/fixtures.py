"""Record / replay store for research I/O (spec §12.2). `record` writes every Exa and LLM response
as <root>/<company-slug>/<kind>-<request-hash>.json; `replay` serves only from those files and
fails loudly on a miss. Keyed by a hash of the canonical request, so a changed query, prompt or
model is a different fixture."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.research.trace.tracer import utcnow


class FixtureMissing(RuntimeError):
    """Replay asked for a response that was never recorded."""


class FixtureStore:
    def __init__(self, root: str | Path):
        self._root = Path(root)

    @staticmethod
    def request_hash(request: dict) -> str:
        canonical = json.dumps(request, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()[:20]

    def path_for(self, company_slug: str, kind: str, request: dict) -> Path:
        return self._root / company_slug / f"{kind}-{self.request_hash(request)}.json"

    def read(self, company_slug: str, kind: str, request: dict) -> Any:
        path = self.path_for(company_slug, kind, request)
        if not path.exists():
            raise FixtureMissing(
                f"no recorded {kind} response for {company_slug} at {path}; "
                f"run this company once with RESEARCH_MODE=record to capture it"
            )
        return json.loads(path.read_text(encoding="utf-8"))["response"]

    def write(self, company_slug: str, kind: str, request: dict, response: Any) -> Path:
        path = self.path_for(company_slug, kind, request)
        path.parent.mkdir(parents=True, exist_ok=True)
        doc = {"recorded_at": utcnow().isoformat(), "request": request, "response": response}
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        return path
