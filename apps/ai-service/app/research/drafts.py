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
