"""Sound for film.html (86.6 s): silence by default, with soft accents on specific moments only.

No music bed and nothing on transitions. Warm electric-piano chords and glassy chimes in F major,
through a gentle reverb, placed on the beats the picture calls for (times are film seconds).
"""
import numpy as np, wave

SR = 48000; DUR = 86.6; N = int(SR * DUR); t = np.arange(N) / SR
L = np.zeros(N); R = np.zeros(N)
def hz(n): return 440.0 * 2 ** ((n - 69) / 12)
def spec(x, fn):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X *= fn(f); return np.fft.irfft(X, len(x))
def lp(x, fc): return spec(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** 4))
def place(sig, a, pan=0.5, amp=1.0):
    i0 = int(round(a * SR)); n = min(len(sig), N - i0)
    if n <= 0: return
    L[i0:i0 + n] += sig[:n] * amp * np.cos(pan * np.pi / 2); R[i0:i0 + n] += sig[:n] * amp * np.sin(pan * np.pi / 2)

def rhodes(n, dur=4.0, vel=1.0, att=0.004):
    ln = int(dur * SR); tt = np.arange(ln) / SR; f = hz(n); idx = 1.2 * np.exp(-tt / 0.3) + 0.2
    s = np.sin(2 * np.pi * f * tt + idx * np.sin(2 * np.pi * f * tt))
    return s * np.minimum(1, tt / att) * np.exp(-tt / 1.6) * np.minimum(1, (dur - tt) / 0.3) * vel
def chime(n, dec=1.6):
    ln = int(dec * 4 * SR); tt = np.arange(ln) / SR; f = hz(n)
    s = np.sin(2 * np.pi * f * tt) + 0.22 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt / 0.25) + 0.08 * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt / 0.08)
    return s * np.minimum(1, tt / 0.002) * np.exp(-tt / dec)
def pad(notes, dur, att, rel):
    ln = int(dur * SR); tt = np.arange(ln) / SR
    env = np.minimum(1, tt / att) * np.minimum(1, np.maximum(0, (dur - tt) / rel))
    s = sum(np.sin(2 * np.pi * hz(n) * tt * (1 + d)) * (0.6 if n > 70 else 1) for n in notes for d in (-0.0012, 0.0012))
    return lp(s, 2500) * env
def sub(dur=3.0, f=43.65, att=0.8):
    ln = int(dur * SR); tt = np.arange(ln) / SR
    return np.sin(2 * np.pi * f * tt) * np.minimum(1, tt / att) * np.exp(-np.maximum(tt - att, 0) / 0.9)
def tap(f=1300):
    ln = int(0.25 * SR); tt = np.arange(ln) / SR
    return (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * f * 2.7 * tt) * np.exp(-tt / 0.02)) * np.minimum(1, tt / 0.001) * np.exp(-tt / 0.05)

F9 = [53, 57, 60, 64, 67]          # F major add9, warm voicing
# opening: the orb rises (0.2 s), "starts with one conversation" (4.0 s)
place(pad([41, 48, 57, 60, 64, 67], 6.5, 1.8, 2.5), 0.2, 0.5, 0.018)
place(sub(4.5, 43.65, 1.6), 0.3, 0.5, 0.12)
for i, n in enumerate([76, 79, 84]): place(chime(n, 1.8), 4.15 + i * 0.12, 0.35 + 0.15 * i, 0.03)
# reveal: logo lands (26.2 s)
for i, n in enumerate(F9): place(rhodes(n, 4.5, 0.8), 26.2 + i * 0.015, 0.3 + 0.1 * i, 0.045)
for i, n in enumerate([81, 84, 88, 91]): place(chime(n, 1.6), 26.25 + i * 0.07, 0.3 + 0.13 * i, 0.022)
place(sub(2.5, 43.65, 0.05), 26.2, 0.5, 0.07)
# the 72% match lands (40.4 s)
place(chime(76, 1.2), 40.45, 0.6, 0.03); place(chime(81, 1.2), 40.55, 0.6, 0.022)
# "Book" click (51.45 s) and the interviewer is ready (53.4 s)
place(tap(1250), 51.45, 0.6, 0.05)
place(chime(72, 1.2), 53.4, 0.5, 0.028); place(chime(79, 1.2), 53.52, 0.5, 0.024)
# score lands (66.8 s), then "Passed · round 3 unlocked" (66.9 s)
for i, n in enumerate([57, 60, 64]): place(rhodes(n, 3.0, 0.7), 66.8, 0.4 + 0.1 * i, 0.035)
place(chime(77, 1.4), 66.95, 0.45, 0.028); place(chime(84, 1.4), 67.1, 0.55, 0.024)
# Interview-ready (73.9 s)
for i, n in enumerate([72, 76, 79, 84]): place(chime(n, 1.6), 73.9 + i * 0.09, 0.3 + 0.13 * i, 0.028)
for n in [53, 57, 60, 64]: place(rhodes(n, 3.0, 0.6), 73.9, 0.5, 0.025)
# final logo (82.2 s): the one grand moment, ringing out to the end
place(pad([41, 48, 53, 57, 60, 64, 67, 72], 4.4, 0.25, 3.0), 82.2, 0.5, 0.02)
for i, n in enumerate([41, 48] + F9): place(rhodes(n, 4.4, 0.85), 82.2 + i * 0.012, 0.25 + 0.08 * i, 0.04)
for i, n in enumerate([84, 88, 91, 96]): place(chime(n, 2.0), 82.3 + i * 0.08, 0.3 + 0.13 * i, 0.02)
place(sub(4.0, 43.65, 0.08), 82.2, 0.5, 0.09)

# gentle reverb
irl = int(3.0 * SR); it = np.arange(irl) / SR
def conv(x, h):
    n = 1 << int(np.ceil(np.log2(len(x) + len(h)))); return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)[: len(x)]
irs = [lp(np.random.default_rng(s).standard_normal(irl) * np.exp(-it / 0.75), 4500) for s in (3, 4)]
for h in irs: h[: int(0.015 * SR)] = 0; h /= np.sqrt(np.sum(h ** 2))
wet = [conv(L, irs[0]), conv(R, irs[1])]
mix = np.stack([L + wet[0] * 0.35, R + wet[1] * 0.35], 1)
fade = np.minimum(1, np.minimum(t / 0.1, (DUR - t) / 0.5)); mix *= fade[:, None]
mix *= 0.5 / np.max(np.abs(mix))          # quiet by design: peaks at about -6 dBFS
with wave.open('soundtrack.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
# report where sound actually is
env = np.abs(mix).max(1); act = [round(a, 1) for a in np.arange(0, DUR, 0.5) if env[int(a * SR):int((a + 0.5) * SR)].max() > 0.02]
print('ok', DUR, 's; audible in', len(act), 'of', int(DUR * 2), 'half-seconds')
