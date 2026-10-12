## Task 6: Identity helpers and snapshot diff (pure)

**Files:**
- Modify: `apps/ai-service/app/research/normalize/identity.py` (created in Task 5 with `domain_of`)
- Create: `apps/ai-service/app/research/drafts.py`
- Test: `apps/ai-service/tests/research/test_identity.py`, `apps/ai-service/tests/research/test_drafts.py`

**Interfaces:**
- Produces:
  - `slugify(name) -> str`, with the same output as the API's TypeScript `slugify`.
  - `name_key(name) -> str`.
  - `domain_of(url) -> str | None`.
  - `find_possible_duplicates(identity: {"name","website","aliases"}, others: list[{"id","name","website","aliases"}]) -> list[{"type": "possible_duplicate", "company_id", "company_name", "reasons": ["name"|"website"]}]`.
  - `flatten_snapshot(snapshot) -> dict[path, value]`.
  - `snapshot_diff(before: dict | None, after: dict) -> list[{"path", "change": "added"|"changed"|"removed", "before", "after"}]`, sorted by path.

- [ ] **Step 1: Write the failing tests**

`apps/ai-service/tests/research/test_identity.py`:

```python
import pytest

from app.research.normalize.identity import domain_of, find_possible_duplicates, name_key, slugify

# Mirrored verbatim in apps/api/test/domain/slug.test.ts. A slug is the join key between Postgres
# rows, briefs and fixture folders, so both languages must agree exactly.
SLUG_CASES = [
    ("Meesho", "meesho"),
    ("  Big   Co ", "big-co"),
    ("Tata Consultancy Services (TCS)", "tata-consultancy-services-tcs"),
    ("AT&T", "at-and-t"),
    ("Café Coffee Day", "cafe-coffee-day"),
    ("Straße Labs", "strae-labs"),
]


@pytest.mark.parametrize("name,expected", SLUG_CASES)
def test_slugify_matches_the_api(name, expected):
    assert slugify(name) == expected


@pytest.mark.parametrize("a,b", [
    ("Amazon India", "Amazon"),
    ("Infosys Limited", "Infosys"),
    ("Zoho Corporation Pvt. Ltd.", "Zoho"),
    ("Meesho", "MEESHO"),
])
def test_name_key_ignores_case_punctuation_and_corporate_suffixes(a, b):
    assert name_key(a) == name_key(b)


def test_name_key_keeps_at_least_one_word():
    assert name_key("Services") == "services"


@pytest.mark.parametrize("url,expected", [
    ("https://www.meesho.com/about", "meesho.com"),
    ("meesho.com", "meesho.com"),
    ("HTTP://Careers.Razorpay.com", "careers.razorpay.com"),
    ("", None),
    (None, None),
])
def test_domain_of(url, expected):
    assert domain_of(url) == expected


def test_duplicates_by_name_alias_or_website():
    others = [
        {"id": "a", "name": "Amazon", "website": None, "aliases": []},
        {"id": "b", "name": "Fashnear", "website": "https://www.meesho.com", "aliases": []},
        {"id": "c", "name": "Unrelated", "website": "https://other.com", "aliases": ["Other Co"]},
    ]
    found = find_possible_duplicates({"name": "Amazon India", "website": "https://meesho.com", "aliases": []}, others)
    assert found == [
        {"type": "possible_duplicate", "company_id": "a", "company_name": "Amazon", "reasons": ["name"]},
        {"type": "possible_duplicate", "company_id": "b", "company_name": "Fashnear", "reasons": ["website"]},
    ]


def test_no_duplicates_when_nothing_matches():
    assert find_possible_duplicates({"name": "Meesho", "website": None, "aliases": []},
                                    [{"id": "x", "name": "Razorpay", "website": None, "aliases": []}]) == []
```

`apps/ai-service/tests/research/test_drafts.py`:

```python
from app.research.drafts import flatten_snapshot, snapshot_diff
from app.research.models import field, unavailable

V1 = {"identity": {
    "name": field("Meesho", confidence="high", provenance="evidence"),
    "website": unavailable(),
    "aliases": field(["Fashnear"], confidence="medium", provenance="evidence"),
}}


def test_flatten_reads_field_values_by_dotted_path():
    assert flatten_snapshot(V1) == {
        "identity.aliases": ["Fashnear"], "identity.name": "Meesho", "identity.website": None,
    }


def test_flatten_keys_role_lists_by_role_key():
    snap = {"roles": [{"role_key": "sde1-backend", "title": field("SDE I", confidence="high", provenance="evidence")}]}
    assert flatten_snapshot(snap) == {"roles[sde1-backend].title": "SDE I"}


def test_first_draft_is_all_additions():
    assert snapshot_diff(None, V1) == [
        {"path": "identity.aliases", "change": "added", "before": None, "after": ["Fashnear"]},
        {"path": "identity.name", "change": "added", "before": None, "after": "Meesho"},
        {"path": "identity.website", "change": "added", "before": None, "after": None},
    ]


def test_changes_and_removals_compare_values_not_metadata():
    v2 = {"identity": {
        "name": field("Meesho", confidence="low", provenance="derived"),     # same value: no change
        "website": field("https://meesho.com", confidence="high", provenance="evidence"),
    }}
    assert snapshot_diff(V1, v2) == [
        {"path": "identity.aliases", "change": "removed", "before": ["Fashnear"], "after": None},
        {"path": "identity.website", "change": "changed", "before": None, "after": "https://meesho.com"},
    ]


def test_identical_snapshots_have_no_diff():
    assert snapshot_diff(V1, V1) == []
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_identity.py tests/research/test_drafts.py -q`
Expected: FAIL with an `ImportError` for `slugify` and `ModuleNotFoundError: app.research.drafts`.

- [ ] **Step 3: Implement**

Replace `apps/ai-service/app/research/normalize/identity.py` with:

```python
"""Company identity helpers (spec §3.2 resolve): slugs, name keys, domains, duplicate detection.
Pure functions. slugify() MUST stay byte-identical to apps/api/src/domain/slug.ts."""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlparse

_SUFFIX_WORDS = frozenset({
    "private", "pvt", "limited", "ltd", "inc", "llc", "llp", "plc", "technologies", "technology", "tech",
    "india", "corp", "corporation", "co", "company", "labs", "software", "solutions", "services", "group",
})


def _ascii_fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()


def slugify(name: str) -> str:
    s = _ascii_fold(name).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def name_key(name: str) -> str:
    """Compact comparison key: "Zoho Corporation Pvt. Ltd." → "zoho". Strips trailing corporate
    words but always keeps the first word, so "Services" alone stays "services"."""
    words = re.findall(r"[a-z0-9]+", _ascii_fold(name).lower())
    while len(words) > 1 and words[-1] in _SUFFIX_WORDS:
        words.pop()
    return "".join(words)


def domain_of(url: str | None) -> str | None:
    if not url:
        return None
    s = url.strip()
    if "://" not in s:
        s = "https://" + s
    host = urlparse(s).hostname
    if not host:
        return None
    host = host.lower()
    return host[4:] if host.startswith("www.") else host


def _keys(name: str | None, aliases: list[str] | None) -> set[str]:
    return {k for k in (name_key(n) for n in [name or "", *(aliases or [])]) if k}


def find_possible_duplicates(identity: dict, others: list[dict]) -> list[dict]:
    keys = _keys(identity.get("name"), identity.get("aliases"))
    domain = domain_of(identity.get("website"))
    found: list[dict] = []
    for other in others:
        reasons: list[str] = []
        if keys & _keys(other.get("name"), other.get("aliases")):
            reasons.append("name")
        if domain and domain == domain_of(other.get("website")):
            reasons.append("website")
        if reasons:
            found.append({"type": "possible_duplicate", "company_id": other["id"],
                          "company_name": other.get("name"), "reasons": reasons})
    return found
```

`apps/ai-service/app/research/drafts.py`:

```python
"""Draft diffing (spec §4.2 `diff`): compare two snapshots by the VALUES of their Field leaves.
Confidence/provenance changes alone are not a change the admin needs to review."""
from __future__ import annotations

from typing import Any


def _is_field(value: Any) -> bool:
    return isinstance(value, dict) and "value" in value and "provenance" in value


def flatten_snapshot(snapshot: dict, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in sorted(snapshot):
        value = snapshot[key]
        path = f"{prefix}{key}"
        if _is_field(value):
            out[path] = value["value"]
        elif isinstance(value, dict):
            out.update(flatten_snapshot(value, path + "."))
        elif isinstance(value, list) and value and all(isinstance(x, dict) and "role_key" in x for x in value):
            for entry in value:
                rest = {k: v for k, v in entry.items() if k != "role_key"}
                out.update(flatten_snapshot(rest, f"{path}[{entry['role_key']}]."))
        else:
            out[path] = value
    return out


def snapshot_diff(before: dict | None, after: dict) -> list[dict]:
    b = flatten_snapshot(before or {})
    a = flatten_snapshot(after)
    changes: list[dict] = []
    for path in sorted(b.keys() | a.keys()):
        if path not in b:
            changes.append({"path": path, "change": "added", "before": None, "after": a[path]})
        elif path not in a:
            changes.append({"path": path, "change": "removed", "before": b[path], "after": None})
        elif b[path] != a[path]:
            changes.append({"path": path, "change": "changed", "before": b[path], "after": a[path]})
    return changes
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research -q`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

