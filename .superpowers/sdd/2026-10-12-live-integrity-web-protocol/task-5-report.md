# Task 5 report: Typing cadence

## Implemented
- `apps/web/features/interview-live/proctor/cadence.ts`: `WINDOW_MS`, `MAX_RHYTHM_GAP_MS`, `MIN_SAMPLES`, `KeyClass`, `classifyKey`, `KeyDown`, `TypingWindowOut`, `CadenceAggregator` (`keyDown`, `keyUp`, `inserted`, `flush`), `CadenceDeps`, `createCadence`. Code copied verbatim from the brief.
- `apps/web/features/interview-live/proctor/cadence.test.ts`: the brief's test text, verbatim.

## Files
- Created: `apps/web/features/interview-live/proctor/cadence.ts`
- Created: `apps/web/features/interview-live/proctor/cadence.test.ts`
- No other files touched. Both new files are untracked in the working tree; nothing committed or staged.

## Pre-checks
- `UNATTRIBUTED_MIN_CHARS = 30` is exported from `activity/provenance.ts` (line 10).
- `EditVia` is exported from `protocol/messages.ts` (`export const EditVia` line 34, `export type EditVia` line 213).
- Both new files end with a newline.

## Deviations
- None.

## Hand-trace of the tests (reading only)
- classifyKey sorting: Enter, Tab and single characters give `char`; Backspace and Delete give `backspace`; arrows, Home, End and PageUp/PageDown give `nav`; Shift and Escape give `other`. Consistent.
- Ctrl or Meta shortcuts give `other`. `|` with Alt and `{` with Ctrl+Alt give `char` (the `ctrlKey && !altKey` guard). Consistent.
- Human-like stretch: gaps give 10 char presses at t = 120, 215, 525, 665, 3265, 3445, 3555, 3645, 4045, 4195. The 9 inter-key gaps have median 150 (sorted middle) and mean about 453 with a 2600 outlier, so cv is about 1.7 (>0.5). Longest pause 2600. Backspace and nav each count 1. Dwell values are all 90, giving `{median: 90, cv: 0}`. `flush(6000)` gives `t1: 6000`. Consistent.
- Metronome: 100 presses at gap 30 give 99 ikis of 30 (cv 0, median 30) and 100 dwells of 90. Consistent.
- Too few samples: 4 presses give 3 ikis and 4 dwells, both below MIN_SAMPLES (5), so `iki` and `dwell` are undefined. Consistent.
- Long gap: the 12000 ms gap exceeds MAX_RHYTHM_GAP_MS, so it is excluded from ikis but still sets `longest_pause`. 5 ikis of 100 remain. Consistent.
- Synthetic keys: an untrusted `other` keydown sets `untrusted = 1` and `keys = 0`. The window is not quiet, so it returns `{keys: 0, untrusted: 1}`. Consistent.
- Inserts: only `typed` (adds chars) and `other` with >= 30 chars (adds charless) count. Expected `charless: 35`, `chars: 0`. Consistent.
- Typed and jumps: 3 chars; lines 3, 4, 2 give one jump (2 < 4). Expected `chars: 3, jumps: 1`. Consistent.
- Quiet window: `flush` with nothing returns null. After a populated flush, the next flush returns null because the counters were reset. Consistent.
- Missed release: the key held 60000 ms exceeds MAX_DWELL_MS (2000), so it is dropped. The 5 later presses give dwell `{median: 90, cv: 0}`. Consistent.
- createCadence: fake timers. A keydown followed by 5000 ms gives one send with `keys: 1`. The next interval is empty and sends nothing. A keydown followed by `stop()` sends once more (total 2). Advancing afterwards sends nothing (timer cleared). Consistent.

Type-level check (by reading): `import type { EditVia }` matches the export; `flush` returns `TypingWindowOut | null`; the `keyUp` wrapper in `createCadence` matches the `CadenceAggregator.keyUp(code, at)` signature.

## Tests
Tests: not run (user's standing rule).

## Concerns
- None blocking. The brief's `createCadence` return type is inferred (no explicit interface), which matches the brief's text.
