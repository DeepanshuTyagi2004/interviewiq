"""Structured diff between two blueprint versions of a session (diagnostics, spec §10)."""
from __future__ import annotations

from typing import Any

_SKIP = {"blueprint_id", "run_id", "created_at", "version", "status", "superseded_at", "provenance"}
_MAX = 300


def _short(v: Any) -> Any:
    if isinstance(v, str) and len(v) > 160:
        return v[:160] + "…"
    if isinstance(v, (list, dict)):
        text = repr(v)
        return text[:160] + "…" if len(text) > 160 else v
    return v


def _walk(a: Any, b: Any, path: str, out: list[dict]) -> None:
    if len(out) >= _MAX:
        return
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if not path and k in _SKIP:
                continue
            _walk(a.get(k), b.get(k), f"{path}.{k}" if path else k, out)
    elif isinstance(a, list) and isinstance(b, list) and not path.endswith("content"):
        for i in range(max(len(a), len(b))):
            _walk(a[i] if i < len(a) else None, b[i] if i < len(b) else None, f"{path}[{i}]", out)
    elif a != b:
        out.append({"path": path, "from": _short(a), "to": _short(b)})


def diff(old: dict, new: dict) -> dict:
    changes: list[dict] = []
    _walk(old, new, "", changes)
    old_slugs = {s["slot_id"]: s["problem"]["slug"] for s in old.get("slots") or []}
    new_slugs = {s["slot_id"]: s["problem"]["slug"] for s in new.get("slots") or []}
    parts_changed = sorted(k for k in set(old.get("input_parts") or {}) | set(new.get("input_parts") or {})
                           if (old.get("input_parts") or {}).get(k) != (new.get("input_parts") or {}).get(k))
    return {
        "from_version": old.get("version"), "to_version": new.get("version"),
        "inputs_changed": parts_changed,
        "problems_changed": {sid: {"from": old_slugs.get(sid), "to": new_slugs.get(sid)}
                             for sid in sorted(set(old_slugs) | set(new_slugs)) if old_slugs.get(sid) != new_slugs.get(sid)},
        "persona_changed": (old.get("persona") or {}).get("name") != (new.get("persona") or {}).get("name"),
        "changes": changes, "truncated": len(changes) >= _MAX,
    }
