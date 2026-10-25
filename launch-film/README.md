# InterviewIQ launch film

`interviewiq-launch.mp4`: 87 s, 1920×1080, 60 fps, AAC stereo. Story: a grand opening (the gold orb rising through its orbit) → the problem (scarce, generic, a guess) → everything pulled
into the orb for the reveal → seven chapters on how it works, each pairing real screens with purpose-built motion graphics →
who it's for → a grand close on a 3D wall of the real screens. Light mode throughout, with dark-mode hints (the problem beat,
the interview room, the end card).
`interviewiq-launch-30s.mp4` is the earlier 30 s cut (`src/film-30s.html`).

- `capture/`: Playwright script that captures real screens from the local web app (`NEXT_PUBLIC_LIVE_MOCK=1 pnpm dev`),
  with the API stubbed in the browser (`fixtures.js`, demo data), the TanStack devtools button hidden, orbs shown in the
  brand gold and the mock interviewer's name removed (the interviewer is a new persona every round).
- `src/film.html`: the motion piece; `render(t)` draws the frame at time `t` (seconds), using the screens in `img/`.
- `src/render.js`: renders 60 fps frames; `src/audio.py`: the sound (`soundtrack.wav`): silence by default, with soft
  chimes and warm chords only on specific moments (opening, reveal, match, booking, score, unlock, Interview-ready, final
  logo); no music bed and nothing on transitions. `audio-76s.py` is the previous full score.

```sh
cd src && mkdir -p frames60
for i in 0 1 2 3; do node render.js $((i*1299)) $(((i+1)*1299)) & done; wait
python3 audio.py
ffmpeg -framerate 60 -i frames60/f%05d.jpg -i soundtrack.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -frames:v 5196 -c:a aac -b:a 192k ../interviewiq-launch.mp4
```

Feature claims follow the code (`CLAUDE.md`, `apps/web`): e.g. proctoring counts screen switches and never pauses, the
camera check runs on-device, delivery is graded from words and timing only, and readiness is never worded as an
endorsement. Scores, profile and company data in the film are demo values.
