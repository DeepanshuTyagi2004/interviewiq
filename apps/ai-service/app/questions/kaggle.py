"""Kaggle dataset fetch via the official REST download endpoint + HTTP basic auth
(username:key). No `kaggle` pip dependency — httpx + stdlib zipfile. Fail-safe: any
problem (no creds, 401, network, no CSV) returns None and the Kaggle source is skipped."""
from __future__ import annotations

import io
import logging
import zipfile

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 60.0


def extract_first_csv(zip_bytes: bytes) -> str | None:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for name in z.namelist():
            if name.lower().endswith(".csv"):
                return z.read(name).decode("utf-8", errors="replace")
    return None


async def fetch_kaggle_csv(settings) -> str | None:
    """Download the Kaggle LeetCode dataset ZIP and return the first CSV's text, or None.
    Requires kaggle_username + kaggle_key to be set; returns None if either is empty
    (so the Kaggle source is silently skipped when credentials are absent)."""
    if not settings.kaggle_username or not settings.kaggle_key:
        logger.debug("[questions] kaggle: credentials not set, skipping")
        return None
    url = f"https://www.kaggle.com/api/v1/datasets/download/{settings.kaggle_leetcode_dataset}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url, auth=(settings.kaggle_username, settings.kaggle_key))
        if resp.status_code != 200:
            logger.warning("[questions] kaggle: HTTP %d for %s", resp.status_code, settings.kaggle_leetcode_dataset)
            return None
        return extract_first_csv(resp.content)
    except Exception as exc:  # noqa: BLE001 — Kaggle is one optional source; any problem → None
        logger.warning("[questions] kaggle: fetch failed (%s) — skipping", exc)
        return None
