"""Strict public member URL identity. Never fetch the supplied URL directly."""
from __future__ import annotations

import re
from urllib.parse import urlsplit


def canonical_profile_url(value: str) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("Provide your HTTPS LinkedIn /in/ profile URL.")
    if re.search(r"[\x00-\x20\x7f\\]", value):
        raise ValueError("Provide your HTTPS LinkedIn /in/ profile URL.")
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or parsed.netloc.lower() not in ("linkedin.com", "www.linkedin.com")
            or not re.fullmatch(r"/in/[A-Za-z0-9][A-Za-z0-9_-]{0,199}/?", parsed.path)):
        raise ValueError("Provide your HTTPS LinkedIn /in/ profile URL without credentials, ports or encoded paths.")
    return "https://www.linkedin.com" + parsed.path.rstrip("/") + "/"
