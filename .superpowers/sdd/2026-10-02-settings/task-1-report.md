# Task 1: Preferences Domain Module — Completion Report

## What Was Implemented

**Files created:**
- `apps/api/src/domain/preferences.ts` — Pure Zod schema, defaults, and utilities for user preferences (locale, interview, notifications, privacy sections).
- `apps/api/test/domain/preferences.test.ts` — Comprehensive test suite covering resolvePreferences, parsePreferencesPatch, and toSetPaths functions.

**Exports (as specified):**
- **Enum tuples** (10): APP_LANGUAGES, DATE_FORMATS, TIME_FORMATS, WEEK_STARTS, INTERVIEW_LANGUAGES, INTERVIEWER_VOICES, SPEAKING_PACES, REMINDER_LEADS, LEADERBOARD_VISIBILITY, NOTIFICATION_TOPICS
- **Types**: Preferences (full schema), PreferencesPatch (partial update schema)
- **Constants**: DEFAULT_PREFERENCES (privacy-first defaults per spec §3.1)
- **Functions**:
  - `parsePreferencesPatch(body: unknown): PreferencesPatch` — Strict validation; throws BadRequestError code "invalid_preferences" with path context
  - `resolvePreferences(stored: unknown): Preferences` — Overlay stored values on defaults per-leaf, fallback on invalid, drop unknown keys
  - `toSetPaths(patch: PreferencesPatch): Record<string, unknown>` — Flatten nested patch to dotted MongoDB $set notation

**Design highlights:**
- Timezone validation uses Intl.DateTimeFormat — rejects unknown zones like "Mars/Olympus" ✓
- `.partial().strict()` works as-is in zod 4 (no fallback needed)
- Overlay function recursively walks PreferencesSchema to implement per-leaf fallback (stale stored values don't break reads)
- toSetPaths correctly skips undefined fields and preserves null leaves

---

## TDD Evidence

### RED: Test Fails (Module Not Found)

```bash
$ pnpm --filter @interviewiq/api exec vitest run test/domain/preferences.test.ts
```

**Output:**
```
Error: Failed to load url ../../src/domain/preferences.js (resolved id: ../../src/domain/preferences.js)
in /Users/salescode/Desktop/project/interviewiq/apps/api/test/domain/preferences.test.ts.
Does the file exist?
```

**Why expected:** The module `src/domain/preferences.ts` did not exist yet.

### GREEN: Tests Pass (All 12 Tests)

```bash
$ pnpm --filter @interviewiq/api exec vitest run test/domain/preferences.test.ts
```

**Output:**
```
✓ test/domain/preferences.test.ts (12 tests) 14ms

Test Files  1 passed (1)
Tests  12 passed (12)
```

**Tests by suite:**
1. `resolvePreferences` — 3 tests
   - Returns defaults when nothing is stored
   - Overlays valid stored values and keeps defaults for the rest
   - Falls back per leaf for stale/invalid stored values and drops unknown keys
   
2. `parsePreferencesPatch` — 5 tests
   - Accepts partial sections, including timezone null (automatic)
   - Rejects invalid pace, unknown section keys, invalid timezone, invalid email field type, non-objects
   
3. `toSetPaths` — 2 tests
   - Flattens patch into dotted $set paths, keeping null leaves
   - Empty patch returns empty object

### Typecheck: No Errors

```bash
$ pnpm --filter @interviewiq/api typecheck
```

**Output:**
```
> @interviewiq/api@0.1.0 typecheck /Users/salescode/Desktop/project/interviewiq/apps/api
> tsc --noEmit
```

No errors reported.

---

## Self-Review Findings

**Completeness vs. brief:**
- ✓ All 10 enum tuples present and exported
- ✓ Both types (Preferences, PreferencesPatch) exported with correct inferred shapes
- ✓ DEFAULT_PREFERENCES constant matches spec §3.1 (privacy-first: anonymous leaderboard, all notifications opt-out except interview/debrief on email, etc.)
- ✓ All three functions (parsePreferencesPatch, resolvePreferences, toSetPaths) implemented and tested

**Naming:**
- ✓ Follows brief exactly (no deviations)
- ✓ Enum tuples use UPPER_CASE
- ✓ Functions use camelCase
- ✓ Schema objects (locale, interview, etc.) use camelCase

**No extras:**
- ✓ No unused code
- ✓ No extra functions or types
- ✓ No unnecessary imports
- ✓ Comments preserved from brief (privacy disclaimer, Mongo $set note)

**Test verification of behaviour:**
- ✓ resolvePreferences overlay logic tested with exact test cases from brief
- ✓ parsePreferencesPatch rejection cases test path context in error message (e.g., "interview.pace", "locale.timezone")
- ✓ toSetPaths flattening verified with multi-level object + null value
- ✓ All edge cases (null input, empty patch, unknown keys) covered

**Output pristine:**
- ✓ No console.logs, debugging code, or stubs
- ✓ All exports are meaningful (no dead code)
- ✓ Module structure matches project conventions (ESM with .js imports)

**Concerns:**
None. All tests pass, typecheck passes, and the implementation matches the brief exactly.

