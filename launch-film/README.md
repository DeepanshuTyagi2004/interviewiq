# InterviewIQ launch film

`interviewiq-launch.mp4`: 30 s, 1920×1080, 30 fps, AAC stereo.

- `capture/`: Playwright script that captures real screens from the local web app (`NEXT_PUBLIC_LIVE_MOCK=1 pnpm dev`),
  with the API stubbed in the browser (`fixtures.js`, demo data) and the TanStack devtools button hidden.
- `src/film.html`: the motion piece; `render(t)` draws the frame at time `t` (seconds). Uses the captured screens in `img/`.
- `src/render.js`: renders frames (`node render.js 0 900` into `src/frames/`); `src/audio.py`: generates `soundtrack.wav`.

```sh
cd src && mkdir -p frames && node render.js 0 900 && python3 audio.py
ffmpeg -framerate 30 -i frames/f%04d.png -i soundtrack.wav -c:v libx264 -crf 16 -pix_fmt yuv420p -c:a aac -b:a 256k -shortest ../interviewiq-launch.mp4
```

Scores, profile and company data in the film are demo values.
