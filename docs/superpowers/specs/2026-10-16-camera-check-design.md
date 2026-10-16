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

Plus the two WebAssembly runtimes (about 3 MB each compressed): about 19 MB on the first visit in all.

**Downloaded once per device, not per interview.** The model files are kept in Cache Storage (`modelCache.ts`,
cache `iq-vision-v1`) and checked against their SHA-256 before use and before caching, so a broken or tampered download
is never kept. The runtimes are kept by the browser's HTTP cache (jsDelivr serves versioned files as immutable for a
year). The instruction page (`PrejoinView.tsx`) prefetches the models, so even a first interview usually starts with
them ready. Measured in Chromium: 19 MB on the first visit, 0 MB on the next ones. Bump `CACHE_NAME` when a model
changes; older `iq-vision-*` caches are deleted on the next load. The browser may still evict the cache under storage
pressure, in which case the files download again.

They load from pinned public CDNs (jsDelivr, Google Storage, Hugging Face at a
fixed revision) by default; `NEXT_PUBLIC_VISION_ASSETS_URL` switches to a self-hosted folder (layout in
`features/interview-live/proctor/camera/vision.ts`). If anything fails to load, the check turns itself off and flags
nothing; a failure of the identity model only turns that one check off.

## 4. Code

`apps/web/features/interview-live/proctor/camera/`: `face.ts` (landmark geometry, alignment, cosine),
`attention.ts` (gaze baseline and threshold), `identity.ts` (enrolment and mismatch streak), `monitor.ts` (episodes,
border state, ledger), `vision.ts` (model loading), `useCameraProctor.ts` (the hook). Wired in `LiveView.tsx` →
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
