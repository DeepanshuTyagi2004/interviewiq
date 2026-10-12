# Task 3 report: the editor clipboard guard

## Implemented
- `apps/web/features/interview-live/proctor/editorClipboard.ts`: `ClipRange`, `ClipSelection`, `ClipboardEditor`, `ForeignInsert`, `EditorClipboardDeps`, `selectedText`, `attachEditorClipboard`, `attachRoomCopyGuard`. Copied verbatim from the brief.
- `apps/web/features/interview-live/proctor/editorClipboard.test.ts`: the brief's tests, verbatim.

Imports from Task 2 (`localClipboard.ts`) checked against the file: `copyToRoom`, `getBuffer`, `bufferIsWholeLine`, `judgePaste`, `CLIPBOARD_MARKER`, `resetClipboard` all exist with the used signatures.

## Files created
- apps/web/features/interview-live/proctor/editorClipboard.ts
- apps/web/features/interview-live/proctor/editorClipboard.test.ts

No other files touched. No commits. Nothing staged.

## Deviations
None.

## Hand-trace of the tests (reading only)
- selectedText, empty selection on line 1 (`sel(1,3,1,3)`): range 1:1 to 2:1, text `a = 1\n`, wholeLine true. Consistent.
- selectedText, empty selection on last line (`sel(2,1,2,1)`): line >= lineCount, range 2:1 to 2:6, text `b = 2`. Consistent.
- selectedText, two selections (`sel(1,1,1,4)`, `sel(2,5,2,11)`): `def` and `return`, joined with `\n`; not all empty so wholeLine false. Consistent.
- copy keeps selection: `sel(2,5,2,13)` slices `return x`; copyToRoom sets buffer and marker; defaultPrevented true; the stopPropagation in onCopy stops the textarea's own listener (added in the bubble phase, target phase is the textarea and host capture runs first, so `seen` is not called). Consistent.
- copy with no selection: `sel(1,4,1,4)` is empty, text `def f(x):\n`, bufferIsWholeLine true; paste with marker triggers with pasteOnNewLine true. Consistent.
- cut: copies `return x`, executeEdits called with `room-cut` and a range matching startLineNumber 2, startColumn 5, endColumn 13, text ''. defaultPrevented true (copyToRoom). Consistent.
- paste with marker and buffer present: judgePaste gives local; asLocalPaste called once; trigger with text `return x`, pasteOnNewLine false (buffer from a non-empty selection); onForeign not called. Consistent.
- paste with marker and empty buffer (afterEach resets it): judgePaste gives ignore; no trigger, no onForeign; defaultPrevented true. Consistent.
- foreign paste: judgePaste gives foreign; executeEdits and trigger not called; onForeign with chars = text.length (31) and lines 2; defaultPrevented true. Consistent.
- empty and blank paste: judgePaste gives ignore for both; onForeign not called. Consistent.
- dragover: defaultPrevented true, dropEffect set to none. Drop with `answer = 42` (11 chars, 1 line): onForeign `{drop, 11, 1}`, defaultPrevented true. Consistent.
- drop with empty text: trim is empty, so no onForeign. Consistent.
- dispose: removeEventListener with the same capture flag removes all five; the paste is not prevented; onForeign not called. Consistent.
- attachRoomCopyGuard, problem panel `<p>`: closest() finds no excluded ancestor; copyToRoom with `two sum`; marker written; prevented. Consistent.
- attachRoomCopyGuard exclusions: for the monaco wrapper the target is the textarea (closest matches `.monaco-editor`); for `<input>` the target is the input itself (closest matches `input`); for excalidraw the target is the canvas (closest matches `.excalidraw`). All return without preventing; buffer stays ''. Consistent. Note: the `wrap` divs stay in the body until afterEach clears them, so the guard's listeners see them. Consistent.

## Tests
Not run (user's standing rule).

## Concerns
None blocking. The copy and paste behaviour inside the Monaco DOM relies on the capture listeners on `host`, which Task 6 must attach to the editor's DOM node (not an inner element), as the brief implies.

## Fix round 1

Finding: onDragOver set dropEffect to 'none'. Under the HTML drag model a drag ending with 'none' fires dragleave, not drop, so onDrop and the foreign-drop signal never ran in a real browser. The synthetic tests dispatched drop directly and masked it.

Changes:
- editorClipboard.ts, onDragOver: removed the `if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'` line. Kept preventDefault and stopPropagation, with a comment saying dragover must stay cancelable so the drop event fires. onDrop is unchanged.
- editorClipboard.test.ts, 'treats dropped text as foreign and refuses the drop': removed the dropEffect assertion and the `dataTransfer` destructuring from the dragover event (the drop event still uses dragEvent(), so the helper is unchanged). Added `const seen = vi.fn(); inner.addEventListener('dragover', seen)` before dispatch and `expect(seen).not.toHaveBeenCalled()` after. Kept `expect(over.event.defaultPrevented).toBe(true)`.

Hand-trace of the amended test:
- dragover on the textarea: the host capture listener runs first, calls preventDefault and stopPropagation, so the event does not reach the target. defaultPrevented is true; `seen` is not called. Consistent.
- drop 'answer = 42' on the textarea: onDrop cancels, reads text/plain, reports {drop, 11, 1}. defaultPrevented true. Consistent.

Files changed in this round: editorClipboard.ts, editorClipboard.test.ts, and this report. Nothing else.
Tests: not run (standing rule). Commits: none.
