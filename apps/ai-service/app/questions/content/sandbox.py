"""Run a generated Python reference solution against its examples and judge tests.

A separate interpreter in isolated mode (`-I`: no site, no user env, no cwd on sys.path), an empty
environment, a CPU-time and memory cap and a wall-clock timeout. The harness imports the solution
file, calls the entry point with each test's named `args`, and prints one JSON array. Results are
compared after a JSON round-trip, so tuples and lists agree. Verification is advisory: a mismatch
marks the problem `unverified`, it never deletes it.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

HARNESS = r'''
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("solution", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fn = getattr(module, sys.argv[2])
out = []
for test in json.load(sys.stdin):
    try:
        out.append({"ok": True, "result": fn(**test["args"])})
    except Exception as exc:  # noqa: BLE001 — reported per test
        out.append({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
def _default(value):
    if isinstance(value, (set, frozenset)):
        return sorted(value, key=repr)
    if isinstance(value, (tuple, range)):
        return list(value)
    return str(value)
print(json.dumps(out, default=_default))
'''


@dataclass
class SandboxResult:
    ran: bool
    passed: int = 0
    failed: int = 0
    failures: list[dict] = field(default_factory=list)
    error: str | None = None

    @property
    def all_passed(self) -> bool:
        return self.ran and self.failed == 0 and self.error is None


def _limits(cpu_seconds: int, memory_bytes: int):
    def apply() -> None:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
            resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
            resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
        except Exception:  # noqa: BLE001 — limits are best effort on this platform
            pass
    return apply


def _normalize(value):
    return json.loads(json.dumps(value, sort_keys=True, default=lambda v: sorted(v, key=repr) if isinstance(v, (set, frozenset)) else list(v) if isinstance(v, tuple) else str(v)))


@dataclass
class CollectResult:
    ran: bool
    outputs: list[dict] = field(default_factory=list)  # one {"ok": True, "result": ...} / {"ok": False, "error": ...} per input
    error: str | None = None


def run_collect(code: str, entry_point: str, args_list: list[dict], *, timeout_seconds: float = 10.0,
                cpu_seconds: int = 5, memory_mb: int = 512) -> CollectResult:
    """Execute `code`'s `entry_point` on each args dict and return the raw outputs (JSON-normalised)."""
    if not args_list:
        return CollectResult(ran=False, error="no inputs")
    with tempfile.TemporaryDirectory(prefix="iq-judge-") as tmp:
        solution = Path(tmp) / "solution.py"
        harness = Path(tmp) / "harness.py"
        solution.write_text(code, encoding="utf-8")
        harness.write_text(HARNESS, encoding="utf-8")
        try:
            proc = subprocess.run(
                [sys.executable, "-I", str(harness), str(solution), entry_point],
                input=json.dumps([{"args": a} for a in args_list]),
                capture_output=True, text=True, timeout=timeout_seconds, cwd=tmp,
                env={"PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1"},
                preexec_fn=_limits(cpu_seconds, memory_mb * 1024 * 1024) if os.name == "posix" else None,
            )
        except subprocess.TimeoutExpired:
            return CollectResult(ran=True, error=f"timed out after {timeout_seconds:g}s")
        except OSError as exc:
            return CollectResult(ran=False, error=f"could not start sandbox: {exc}")
    if proc.returncode != 0 or not proc.stdout.strip():
        tail = (proc.stderr or "").strip().splitlines()[-1:] or ["no output"]
        return CollectResult(ran=True, error=f"solution crashed: {tail[0][:300]}")
    try:
        outputs = json.loads(proc.stdout.strip().splitlines()[-1])
    except json.JSONDecodeError:
        return CollectResult(ran=True, error="harness output was not JSON")
    return CollectResult(ran=True, outputs=outputs)


def same(a, b) -> bool:
    """Equality after a JSON round-trip, so tuples/lists and sets agree."""
    return _normalize(a) == _normalize(b)


def _canonical(value):
    """Lists sorted recursively, for answers where any order is acceptable."""
    if isinstance(value, list):
        return sorted((_canonical(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True, default=str))
    if isinstance(value, dict):
        return {k: _canonical(v) for k, v in value.items()}
    return value


def same_unordered(a, b) -> bool:
    """Equality ignoring list order at every level ("return the indices in any order")."""
    return _canonical(_normalize(a)) == _canonical(_normalize(b))


def run_reference(code: str, entry_point: str, tests: list[dict], *, timeout_seconds: float = 10.0,
                  cpu_seconds: int = 5, memory_mb: int = 512) -> SandboxResult:
    """Execute `code`'s `entry_point` on each `{"args": {...}, "expected": ...}` and compare."""
    if not tests:
        return SandboxResult(ran=False, error="no tests")
    with tempfile.TemporaryDirectory(prefix="iq-judge-") as tmp:
        solution = Path(tmp) / "solution.py"
        harness = Path(tmp) / "harness.py"
        solution.write_text(code, encoding="utf-8")
        harness.write_text(HARNESS, encoding="utf-8")
        try:
            proc = subprocess.run(
                [sys.executable, "-I", str(harness), str(solution), entry_point],
                input=json.dumps([{"args": t["args"]} for t in tests]),
                capture_output=True, text=True, timeout=timeout_seconds, cwd=tmp,
                env={"PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1"},
                preexec_fn=_limits(cpu_seconds, memory_mb * 1024 * 1024) if os.name == "posix" else None,
            )
        except subprocess.TimeoutExpired:
            return SandboxResult(ran=True, failed=len(tests), error=f"timed out after {timeout_seconds:g}s")
        except OSError as exc:
            return SandboxResult(ran=False, error=f"could not start sandbox: {exc}")
    if proc.returncode != 0 or not proc.stdout.strip():
        tail = (proc.stderr or "").strip().splitlines()[-1:] or ["no output"]
        return SandboxResult(ran=True, failed=len(tests), error=f"solution crashed: {tail[0][:300]}")
    try:
        results = json.loads(proc.stdout.strip().splitlines()[-1])
    except json.JSONDecodeError:
        return SandboxResult(ran=True, failed=len(tests), error="harness output was not JSON")
    out = SandboxResult(ran=True)
    for index, (test, result) in enumerate(zip(tests, results)):
        if not result.get("ok"):
            out.failed += 1
            out.failures.append({"index": index, "args": test["args"], "expected": test.get("expected"), "error": result.get("error")})
        elif _normalize(result.get("result")) == _normalize(test.get("expected")):
            out.passed += 1
        else:
            out.failed += 1
            out.failures.append({"index": index, "args": test["args"], "expected": test.get("expected"), "got": result.get("result")})
    return out
