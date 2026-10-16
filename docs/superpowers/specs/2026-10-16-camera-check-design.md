# Live room: on-device camera check (design)

Status: built 2026-10-16. Decisions approved by the user the same day: new dependencies `@mediapipe/tasks-vision`
and `onnxruntime-web`; a violation drives the camera tile's border and the camera ledger only.

## 1. What it checks

During the round, on the candidate's own device, about five frames a second:

1. **Only one person in view.** Two or more faces (`multiple_faces`); nobody in view (`no_face`).
2. **The same person throughout** (`face_changed`). The first clear, facing frames of the round enrol the
   candidate's face embedding; later checks (every 3 s) compare against it, and two mismatches in a row make it a
   different person.
3. **Looking at the screen** (`looking_away`). Head pose against the candidate's own baseline (the first ~2 s of
   facing frames, since cameras sit above, below or beside screens), plus eye-direction blendshapes.

## 2. What a violation does

- **Border** on the candidate's camera tile: green (fine), amber (a condition began and hasn't lasted its
  threshold yet), red (a flagged condition is still going on). No border while the models load, or when this browser
  can't run them.
- **Camera ledger**: one entry per sustained episode (`no_face` 3 s, `multiple_faces` 1.5 s, `looking_away` 5 s,
  `face_changed` at once since the identity check already waits), counted as "Camera flags" in the room header, and a
  bar telling the candidate what to fix while a flagged condition lasts. An episode closes once its condition has been
  gone 1.5 s, so flicker never counts twice.
- **Nothing else.** It is not sent to the interviewer, does not count toward the proctoring end rule (spec
  2026-10-12 §7), and never changes a score, gate, readiness or report. Making it count is a scoring/gating decision
  for the human.

## 3. Cost and privacy

No LLM calls and no server work: both models run in the browser (WebAssembly; GPU where available). No frame, crop or
embedding leaves the device, and nothing is stored after the room closes.

| Model | Purpose | Size | Licence |
| --- | --- | --- | --- |
| MediaPipe Face Landmarker (float16) | face count, landmarks, eye blendshapes | 3.7 MB | Apache-2.0 |
| OpenCV Zoo SFace, int8 | 128-number face embedding of an aligned 112x112 crop | 9.9 MB | Apache-2.0 |

Plus the two WebAssembly runtimes: five files, about 40 MB uncompressed and about 19 MB over the wire.

**Downloaded once per device, in the background, never during an interview** (`visionAssets.ts`):

- **When.** Three seconds after any signed-in page loads (`VisionPrefetch` in the `(app)` layout), and again when
  the instruction page mounts (to retry after an error). Files already on the device are skipped.
- **Where.** Cache Storage, cache `iq-vision-v2`. Every file is checked against its SHA-256 before it is stored and
  again when the room reads it, so a broken or tampered download is never kept or used. Bump `CACHE_NAME` when a file
  changes; older `iq-vision-*` caches are deleted on the next load.
- **Paused during the round.** The live room (`LiveView`) holds the download for its whole length: the file in
  flight is aborted (it restarts from scratch when the hold is released, finished files are kept), so the
  interview gets the bandwidth.
- **The room never downloads.** `vision.ts` reads every file (runtimes included, as blob URLs and `wasmBinary`)
  from the device copy only. If they aren't all there, the round runs without the camera check: no border, no
  camera-flag counter, no camera bar.
- **Shown before joining.** The instruction page shows, above the camera preview, a tick ("Camera check ready") or
  a cross with the reason: downloading with a progress bar, paused, failed (with Retry), or not available in this
  browser (no Cache Storage).
- **Failures.** Each file is tried three times (5 s, then 20 s apart); then the state is `error` until the next
  start, a Retry, or the browser coming back online.

Measured in Chromium: the room with nothing on the device starts at once with the check off and fetches nothing;
while held, 0 bytes in 5 s; after release the download finishes; the room with everything on the device runs the
check and fetches nothing; a later visit finds everything on the device and downloads nothing. The browser may still
evict the cache under storage pressure, in which case the files download again in the background.

Self-hosting: `NEXT_PUBLIC_VISION_ASSETS_URL` points all five files at one folder (same file names, same bytes).

## 4. Code

`apps/web/features/interview-live/proctor/camera/`: `face.ts` (landmark geometry, alignment, cosine),
`attention.ts` (gaze baseline and threshold), `identity.ts` (enrolment and mismatch streak), `monitor.ts` (episodes,
border state, ledger), `visionAssets.ts` (background download and device cache), `vision.ts` (model loading from the
device), `useCameraProctor.ts` (the hook), `CameraCheckStatus.tsx` and `VisionPrefetch.tsx`. Wired in `LiveView.tsx` →
`RoomStage` → `InterviewerStrip` → `CameraTile`, plus `RoomHeader` (counter) and `ProctorBars` (bar). Disclosed on the
instruction page (`PrejoinView.tsx`).

## 5. Verification

Unit tests cover the geometry, calibration, identity streak, monitor episodes and the hook (with fake models). A
manual browser run (Chromium, fake camera fed with real photos, real models from the CDNs) showed: one person green,
two people in view red as `multiple_faces`, a different person red as `face_changed`, the original person back to
green. Faces far from the camera (about 45 px in a 640x480 frame) are not detected at all and read as `no_face`; the
landmarker's detector is a short-range (selfie-distance) one.

## 6. Open / to tune

- Thresholds (`ATTENTION`, `IDENTITY`, `SUSTAIN_MS`) are first guesses; tune them on real candidates, especially
  `looking_away` (typing while glancing at the keyboard must stay green).
- Enrolment trusts whoever is on camera in the first seconds of the round; enrolling at the pre-join check is a
  possible follow-up.
- Sending the camera ledger to the worker/report would need a protocol change and the human's call on what it means.
