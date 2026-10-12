## Task 2: Redaction and error capture

**Files:**
- Create: `apps/ai-service/app/research/trace/__init__.py`, `apps/ai-service/app/research/trace/redact.py`, `apps/ai-service/app/research/trace/errors.py`
- Test: `apps/ai-service/tests/research/test_redact.py`, `apps/ai-service/tests/research/test_errors.py`

**Interfaces:**
- Consumes: `check_transition` and `InvalidTransition` (Task 1), used to raise from an `app/research` frame in tests.
- Produces:
  - `redact(value: Any, secrets: Mapping[str, str]) -> Any`.
  - `secrets_from_settings(settings) -> dict[str, str]`.
  - `code_ref(exc) -> str | None`.
  - `error_info(exc) -> {"type", "message", "traceback", "code_ref"}`.

- [ ] **Step 1: Write the failing tests**

`apps/ai-service/tests/research/test_redact.py`:

```python
from app.config import Settings
from app.research.trace.redact import redact, secrets_from_settings

SECRETS = {"EXA_API_KEY": "exa-secret-123"}


def test_redacts_secret_values_wherever_they_appear():
    out = redact({"msg": "401 for key exa-secret-123!", "nested": [{"k": "exa-secret-123"}]}, SECRETS)
    assert out == {"msg": "401 for key «redacted:EXA_API_KEY»!", "nested": [{"k": "«redacted:EXA_API_KEY»"}]}


def test_redacts_auth_headers_by_name_case_insensitively():
    out = redact({"Authorization": "Bearer abc", "X-Internal-Api-Key": "k", "x-api-key": "e", "Accept": "json"}, {})
    assert out == {
        "Authorization": "«redacted:header»", "X-Internal-Api-Key": "«redacted:header»",
        "x-api-key": "«redacted:header»", "Accept": "json",
    }


def test_leaves_non_string_scalars_alone():
    assert redact({"n": 42, "b": True, "none": None, "f": 1.5}, SECRETS) == {"n": 42, "b": True, "none": None, "f": 1.5}


def test_tuples_become_lists_and_input_is_not_mutated():
    original = {"t": ("exa-secret-123", 1)}
    assert redact(original, SECRETS) == {"t": ["«redacted:EXA_API_KEY»", 1]}
    assert original == {"t": ("exa-secret-123", 1)}


def test_secrets_from_settings_names_each_llm_key_and_skips_short_values(monkeypatch):
    monkeypatch.setenv("EXA_API_KEY", "exa-long-key")
    monkeypatch.setenv("LLM_API_KEY", "key-one-long,key-two-long")
    monkeypatch.setenv("INTERNAL_API_KEY", "x")  # too short to redact safely: matching "x" would shred text
    names = secrets_from_settings(Settings(_env_file=None))
    assert names == {"EXA_API_KEY": "exa-long-key", "LLM_API_KEY#0": "key-one-long", "LLM_API_KEY#1": "key-two-long"}
```

`apps/ai-service/tests/research/test_errors.py`:

```python
import pytest

from app.research.models import InvalidTransition, check_transition
from app.research.trace.errors import code_ref, error_info


def test_error_info_points_code_ref_at_the_innermost_research_frame():
    with pytest.raises(InvalidTransition) as caught:
        check_transition("completed", "stop")
    info = error_info(caught.value)
    assert info["type"] == "InvalidTransition"
    assert "cannot stop a run that is completed" in info["message"]
    assert info["code_ref"] == "app/research/models.py:check_transition"
    assert "Traceback" in info["traceback"]


def test_code_ref_is_none_outside_the_research_package():
    try:
        raise ValueError("boom")
    except ValueError as exc:
        assert code_ref(exc) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_redact.py tests/research/test_errors.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.research.trace'`.

- [ ] **Step 3: Implement**

`apps/ai-service/app/research/trace/__init__.py`:

```python
"""Full-verbosity tracing for research runs (spec §10)."""
```

`apps/ai-service/app/research/trace/redact.py`:

```python
"""Scrub secrets before anything reaches Mongo or the admin UI (spec §10.3).

Two passes: (1) any mapping key that is an auth header is replaced wholesale; (2) any string
containing a configured secret value has that value replaced with «redacted:<NAME>». Values
shorter than _MIN_SECRET_LEN are never treated as secrets: replacing "x" everywhere would shred
every payload (test env keys are 1 character)."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

_SECRET_HEADERS = frozenset({"authorization", "x-api-key", "x-internal-api-key"})
_MIN_SECRET_LEN = 6


def secrets_from_settings(settings: Any) -> dict[str, str]:
    named: dict[str, str] = {
        "EXA_API_KEY": settings.exa_api_key,
        "INTERNAL_API_KEY": settings.internal_api_key,
    }
    for i, key in enumerate(settings.llm_api_keys):
        named[f"LLM_API_KEY#{i}"] = key
    return {name: value for name, value in named.items() if value and len(value) >= _MIN_SECRET_LEN}


def redact(value: Any, secrets: Mapping[str, str]) -> Any:
    if isinstance(value, str):
        for name, secret in secrets.items():
            if secret in value:
                value = value.replace(secret, f"«redacted:{name}»")
        return value
    if isinstance(value, Mapping):
        return {
            k: "«redacted:header»" if isinstance(k, str) and k.lower() in _SECRET_HEADERS else redact(v, secrets)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v, secrets) for v in value]
    return value
```

`apps/ai-service/app/research/trace/errors.py`:

```python
"""Turn an exception into what the debugger shows: type, message, full traceback, and a code_ref
("app/research/nodes/resolve.py:resolve") naming the innermost pipeline frame so Claude Code can
jump straight to the code (spec §10.4)."""
from __future__ import annotations

import traceback

_MAX_MESSAGE = 2000
_MAX_TRACEBACK = 20_000
_MARKER = "/app/research/"


def code_ref(exc: BaseException) -> str | None:
    for frame in reversed(traceback.extract_tb(exc.__traceback__)):
        path = frame.filename.replace("\\", "/")
        i = path.rfind(_MARKER)
        if i != -1:
            return f"{path[i + 1:]}:{frame.name}"
    return None


def error_info(exc: BaseException) -> dict:
    return {
        "type": type(exc).__name__,
        "message": str(exc)[:_MAX_MESSAGE],
        "traceback": "".join(traceback.format_exception(exc))[-_MAX_TRACEBACK:],
        "code_ref": code_ref(exc),
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research -q`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

