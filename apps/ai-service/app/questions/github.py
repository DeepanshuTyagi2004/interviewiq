"""Fetch a whole GitHub repo as ONE tarball (codeload), parsed in memory.

Why a tarball: the snehasishroy DSA repo has hundreds of company folders — per-file
GitHub API fetches blow past the 60 req/hr unauthenticated limit. The codeload
tarball is a single unauthenticated request, then we walk it with stdlib tarfile."""
from __future__ import annotations

import io
import logging
import tarfile

import httpx

logger = logging.getLogger(__name__)


class GithubFetchError(RuntimeError):
    """Repo tarball could not be fetched — the source is skipped, the run continues."""


def parse_tarball(data: bytes, *, prefix_strip: bool = True) -> dict[str, bytes]:
    """Extract a .tar.gz into {relative_path: file_bytes}. codeload wraps every entry in a
    single top-level '<repo>-<ref>/' dir; with prefix_strip that prefix is removed. Dirs skipped."""
    out: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            name = member.name
            if prefix_strip and "/" in name:
                name = name.split("/", 1)[1]
            if not name or name.endswith("/"):
                continue
            f = tar.extractfile(member)
            if f is not None:
                out[name] = f.read()
    return out


async def fetch_repo_files(owner: str, repo: str, ref: str, settings) -> dict[str, bytes]:
    """Download owner/repo@ref as a tarball and return {path: bytes}. Raises GithubFetchError
    on any transport/HTTP failure so the caller can skip just this source."""
    url = f"{settings.github_codeload_base.rstrip('/')}/{owner}/{repo}/tar.gz/refs/heads/{ref}"
    try:
        async with httpx.AsyncClient(timeout=settings.github_timeout_seconds, follow_redirects=True) as client:
            resp = await client.get(url)
    except (httpx.TimeoutException, httpx.ConnectError) as exc:
        raise GithubFetchError(f"GitHub fetch failed for {owner}/{repo}@{ref}: {exc}") from exc
    if resp.status_code != 200:
        raise GithubFetchError(f"GitHub returned {resp.status_code} for {owner}/{repo}@{ref}")
    logger.info("[questions] fetched %s/%s@%s (%d bytes)", owner, repo, ref, len(resp.content))
    return parse_tarball(resp.content)
