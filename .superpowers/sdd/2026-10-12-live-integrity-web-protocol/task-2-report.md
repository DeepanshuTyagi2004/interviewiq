# Task 2 report: The room clipboard

## Implemented
- Created `apps/web/features/interview-live/proctor/localClipboard.ts`: the marker constant, dev/production rule switch, room buffer (text plus whole-line flag), cleared flag, `copyToRoom`, `clearSystemClipboard` (never rejects), `judgePaste` and the `PasteVerdict` type. Code is verbatim from the brief.
- Created `apps/web/features/interview-live/proctor/localClipboard.test.ts`: verbatim from the brief.
- Appended to `apps/web/.env.example` (existing content kept): a comment block and `NEXT_PUBLIC_ENFORCE_CLIPBOARD=0`. The file previously ended with `NEXT_PUBLIC_LIVE_MOCK=0`, and a blank line was added before the new block.

## Files touched
- `apps/web/features/interview-live/proctor/localClipboard.ts` (new)
- `apps/web/features/interview-live/proctor/localClipboard.test.ts` (new)
- `apps/web/.env.example` (appended)

No other files were touched. Nothing was committed, staged or reverted.

## Pre-edit checks
- `git status --short` on `.env.example` and the proctor directory was clean before editing. No concurrent changes were seen.
- No `localClipboard*` files existed before.

## Deviations
None.

## Hand-trace of the test file (reading only)
- `clipboardRulesActive`: dev with flag `''` gives false; flag `'1'` gives true; flag `'0'` gives false; production gives true. Consistent with the code's `NODE_ENV === 'production' || flag === '1'`.
- `copyToRoom` plain: calls `preventDefault`, sets buffer to `'x = 1'`, line flag false, `setData('text/plain', marker)`. Consistent.
- `copyToRoom` whole line: the line flag becomes true. Consistent.
- `copyToRoom` empty: `preventDefault` is still called, returns before changing the buffer, and writes nothing. Buffer stays `'first'`, `written` is `{}`. Consistent.
- `judgePaste(marker)` with buffer: `'local'`. Without buffer (afterEach reset): `'ignore'`. Consistent.
- `judgePaste('')` and `' \n\t'`: both trim to empty, so `'ignore'`. Consistent.
- `judgePaste('def solve(): pass')` and marker-plus-suffix: both `'foreign'`. Consistent.
- `clearSystemClipboard` in production with a resolving stub: `writeText` called with the marker, `cleared` true, returns true. Consistent.
- Refusal: the thrown error is caught, `cleared` false, returns false. Consistent.
- Dev: returns false before any write, so `writeText` is not called. Consistent.
- Reset after clear: `resetClipboard` clears the flag. Consistent.
- `forgetBuffer`: clears buffer and line flag, leaves `cleared` true. Consistent.
- Test setup: `Object.defineProperty(navigator, 'clipboard', { configurable: true, ... })` is removed in afterEach with `Reflect.deleteProperty`, so each test starts clean.

Type check by reading: `event.clipboardData?.setData` matches `ClipboardEvent.clipboardData: DataTransfer | null`. The `as unknown as ClipboardEvent` cast in the test is valid. The stub `async () => { throw ... }` fits `(text: string) => Promise<void>`.

## Tests
Not run (user's standing rule).

## Concerns
None for this task. The module is standalone and has no imports, so the consumers (Tasks 3, 6, 7, 8, 9) only need the exports listed in the brief's Interfaces section, and all of them are present.
