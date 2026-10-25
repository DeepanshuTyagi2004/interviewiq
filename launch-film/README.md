# InterviewIQ launch film

`interviewiq-launch.mp4`: 2 min, 1920×1080, 30 fps, AAC stereo. Story: the problem → what InterviewIQ is → how it works
(profile, role and match, the real process as a track, booking and prep, the live interview, the debrief, gating and
readiness) → who it's for. Light mode throughout, with dark-mode hints (the problem beat, the interview room, the end card).
`interviewiq-launch-30s.mp4` is the earlier 30 s cut (`src/film-30s.html`).

- `capture/`: Playwright script that captures real screens from the local web app (`NEXT_PUBLIC_LIVE_MOCK=1 pnpm dev`),
  with the API stubbed in the browser (`fixtures.js`, demo data), the TanStack devtools button hidden, orbs shown in the
  brand gold and the mock interviewer's name removed (the interviewer is a new persona every round).
- `src/film.html`: the motion piece; `render(t)` draws the frame at time `t` (seconds), using the captured screens in `img/`.
- `src/render.js`: renders frames; `src/audio.py`: generates the score (`soundtrack.wav`), with cues timed to the picture.

```sh
cd src && mkdir -p frames
for i in 0 1 2 3; do node render.js $((i*900)) $(((i+1)*900)) & done; wait
python3 audio.py
ffmpeg -framerate 30 -i frames/f%04d.jpg -i soundtrack.wav -c:v libx264 -crf 17 -pix_fmt yuv420p -c:a aac -b:a 256k -shortest ../interviewiq-launch.mp4
```

Feature claims follow the code (`CLAUDE.md`, `apps/web`): e.g. proctoring counts screen switches and never pauses, the
camera check runs on-device, delivery is graded from words and timing only, and readiness is never worded as an
endorsement. Scores, profile and company data in the film are demo values.
