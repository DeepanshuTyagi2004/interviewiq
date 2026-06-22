"""Kaggle dataset fetcher for the LeetCode problem dataset.
# ponytail: uses the unofficial Kaggle public CSV download URL (no auth required for public
# datasets). If Kaggle changes the URL pattern or the dataset is removed, this fails gracefully
# and returns None — the collect_kaggle caller logs a warning and returns []."""
from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

_KAGGLE_CSV_URL = "https://www.kaggle.com/datasets/{slug}/download?datasetVersionNumber=1"
# Kaggle redirects to a GCS URL; follow_redirects required. Large file so longer timeout.
_TIMEOUT = 60.0


async def fetch_kaggle_csv(settings) -> str | None:
    """Download the Kaggle LeetCode dataset CSV. Returns raw CSV text or None on any failure.
    Requires kaggle_username + kaggle_key to be set; returns None if either is empty
    (so neetcode_repo="" config silently skips this source)."""
    if not settings.kaggle_username or not settings.kaggle_key:
        logger.debug("[questions] kaggle: credentials not set, skipping")
        return None
    slug = settings.kaggle_leetcode_dataset
    url = f"https://www.kaggle.com/api/v1/datasets/download/{slug}/{slug.split('/')[-1]}.csv"
    try:
        async with httpx.AsyncClient(
            auth=(settings.kaggle_username, settings.kaggle_key),
            timeout=_TIMEOUT,
            follow_redirects=True,
        ) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            logger.warning("[questions] kaggle: HTTP %d for %s", resp.status_code, slug)
            return None
        return resp.text
    except httpx.HTTPError as exc:
        logger.warning("[questions] kaggle: fetch failed (%s)", exc)
        return None
