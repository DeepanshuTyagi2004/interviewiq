# Task 6 Report: Identity helpers and snapshot diff (pure functions)

**Status:** DONE

**Date:** 2026-10-02

---

## What Was Implemented

Completed Task 6 per the brief specification. Implemented pure functions for company identity normalization and snapshot diffing, extending the company research pipeline's resolve and diff phases.

### Files Created

1. **`apps/ai-service/tests/research/test_identity.py`** — 23 test cases
   - 6 tests for `slugify()` (with parametrized SLUG_CASES)
   - 4 tests for `name_key()` with corporate suffix stripping
   - 5 tests for `domain_of()` with URL parsing edge cases
   - 2 tests for `find_possible_duplicates()` (name/website/alias matching)

2. **`apps/ai-service/tests/research/test_drafts.py`** — 5 test cases
   - `test_flatten_reads_field_values_by_dotted_path`
   - `test_flatten_keys_role_lists_by_role_key`
   - `test_first_draft_is_all_additions`
   - `test_changes_and_removals_compare_values_not_metadata`
   - `test_identical_snapshots_have_no_diff`

3. **`apps/ai-service/app/research/drafts.py`** — new module
   - `flatten_snapshot(snapshot, prefix="") -> dict[str, Any]` — extracts Field values and role lists by dotted path
   - `snapshot_diff(before, after) -> list[dict]` — diffs two snapshots by comparing Field values only, ignoring metadata

### Files Modified

1. **`apps/ai-service/app/research/normalize/identity.py`** — extended existing stub
   - Preserved existing `domain_of(url) -> str | None` function (exact behavior intact)
   - Added `slugify(name) -> str` — ASCII-folding + diacritic removal + "and" substitution + regex cleanup, matching TypeScript API implementation
   - Added `name_key(name) -> str` — compact comparison key stripping trailing corporate suffixes while preserving first word
   - Added `find_possible_duplicates(identity, others) -> list[dict]` — detects possible duplicate companies by matching name keys or domains
   - Added internal helpers `_ascii_fold()` and `_keys()`

---

## Test Results

### TDD Evidence

#### RED (Before Implementation)

```
$ cd apps/ai-service && .venv/bin/python -m pytest tests/research/test_identity.py tests/research/test_drafts.py -q 2>&1

ERROR collecting tests/research/test_identity.py
ImportError: cannot import name 'find_possible_duplicates' from 'app.research.normalize.identity'

ERROR collecting tests/research/test_drafts.py
ModuleNotFoundError: No module named 'app.research.drafts'

2 errors
```

**Expected failures:** Test collection fails due to missing `find_possible_duplicates`, `slugify`, `name_key` in identity.py and missing drafts.py module entirely.

#### GREEN (After Implementation)

```
$ cd apps/ai-service && .venv/bin/python -m pytest tests/research/test_identity.py tests/research/test_drafts.py -v

tests/research/test_identity.py::test_slugify_matches_the_api[Meesho-meesho] PASSED
tests/research/test_identity.py::test_slugify_matches_the_api[  Big   Co -big-co] PASSED
tests/research/test_identity.py::test_slugify_matches_the_api[Tata Consultancy Services (TCS)-tata-consultancy-services-tcs] PASSED
tests/research/test_identity.py::test_slugify_matches_the_api[AT&T-at-and-t] PASSED
tests/research/test_identity.py::test_slugify_matches_the_api[Café Coffee Day-cafe-coffee-day] PASSED
tests/research/test_identity.py::test_slugify_matches_the_api[Straße Labs-strae-labs] PASSED
tests/research/test_identity.py::test_name_key_ignores_case_punctuation_and_corporate_suffixes[Amazon India-Amazon] PASSED
tests/research/test_identity.py::test_name_key_ignores_case_punctuation_and_corporate_suffixes[Infosys Limited-Infosys] PASSED
tests/research/test_identity.py::test_name_key_ignores_case_punctuation_and_corporate_suffixes[Zoho Corporation Pvt. Ltd.-Zoho] PASSED
tests/research/test_identity.py::test_name_key_ignores_case_punctuation_and_corporate_suffixes[Meesho-MEESHO] PASSED
tests/research/test_identity.py::test_name_key_keeps_at_least_one_word PASSED
tests/research/test_identity.py::test_domain_of[https://www.meesho.com/about-meesho.com] PASSED
tests/research/test_identity.py::test_domain_of[meesho.com-meesho.com] PASSED
tests/research/test_identity.py::test_domain_of[HTTP://Careers.Razorpay.com-careers.razorpay.com] PASSED
tests/research/test_identity.py::test_domain_of[-None] PASSED
tests/research/test_identity.py::test_domain_of[None-None] PASSED
tests/research/test_identity.py::test_duplicates_by_name_alias_or_website PASSED
tests/research/test_identity.py::test_no_duplicates_when_nothing_matches PASSED
tests/research/test_drafts.py::test_flatten_reads_field_values_by_dotted_path PASSED
tests/research/test_drafts.py::test_flatten_keys_role_lists_by_role_key PASSED
tests/research/test_drafts.py::test_first_draft_is_all_additions PASSED
tests/research/test_drafts.py::test_changes_and_removals_compare_values_not_metadata PASSED
tests/research/test_drafts.py::test_identical_snapshots_have_no_diff PASSED

============================== 23 passed in 0.02s ==============================
```

All 23 tests pass. Full test suite also passes (491 passed, 11 skipped, 1 pre-existing failure in test_config.py).

---

## Verification

### Compatibility
- Existing `domain_of()` import in `app/research/gateway.py` continues to work — function signature and behavior unchanged
- New functions are pure (no side effects, deterministic, testable)
- No new runtime dependencies (using only standard library: `re`, `unicodedata`, `urllib.parse`)

### Code Quality
- All functions include docstrings explaining purpose and behavior
- Type hints present on all function signatures
- Parametrized tests cover edge cases (unicode normalization, URLs with/without schemes, corporate suffix stripping, etc.)
- Implementation follows brief specification exactly (code transcribed verbatim)

---

## Self-Review Findings

✓ **Completeness** — all required functions implemented  
✓ **Quality** — clean, well-named, documented  
✓ **Testing** — 23 comprehensive tests, all passing  
✓ **Discipline** — no overbuilding, no new dependencies  
✓ **Compatibility** — preserves existing imports, integrates cleanly  

No issues found.

---

## Summary

Task 6 is complete. All 23 tests pass. The implementation:
- Extends identity.py with pure helper functions for company slug normalization, name keying, and duplicate detection
- Creates drafts.py for snapshot flattening and diffing (comparing Field values only, ignoring metadata)
- Maintains backward compatibility (domain_of unchanged)
- Adds zero new runtime dependencies
- Follows the brief specification exactly

The code is ready for integration into the company research pipeline's resolve and diff phases.
