"""Research targets: the active companies interviewiq-api says to research (spec §3.1), read from its
internal endpoint with the shared key. Unlike the brief pipeline's targets, failure is an error:
an admin pressing Start must hear why nothing ran."""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


class TargetsUnavailable(RuntimeError):
    """interviewiq-api could not be reached or returned an error."""


@dataclass(frozen=True)
class ResearchTarget:
    id: str
    name: str
    slug: str
    website: str | None = None
    aliases: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "slug": self.slug, "website": self.website,
                "aliases": list(self.aliases)}

    @classmethod
    def from_row(cls, row: dict) -> "ResearchTarget":
        return cls(id=row["id"], name=row["name"], slug=row["slug"], website=row.get("website"),
                   aliases=tuple(row.get("aliases") or ()))


async def fetch_research_targets(settings: Settings) -> list[ResearchTarget]:
    url = settings.api_base_url.rstrip("/") + "/api/v1/internal/research-targets"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers={"X-Internal-Api-Key": settings.internal_api_key})
            resp.raise_for_status()
            rows = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise TargetsUnavailable(f"could not load research targets from {url}: {exc}") from exc
    targets: list[ResearchTarget] = []
    for row in rows:
        try:
            targets.append(ResearchTarget.from_row(row))
        except (KeyError, TypeError) as exc:
            logger.warning("ignoring malformed research target %r: %s", row, exc)
    return targets
