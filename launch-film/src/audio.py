"""Generated 120 s score for film.html: every cue below is timed to an on-screen event."""
import numpy as np, wave
SR = 48000; DUR = 120.0; N = int(SR * DUR); t = np.arange(N) / SR
rng = np.random.default_rng(11)
L = np.zeros(N); R = np.zeros(N)
def hz(n): return 440 * 2 ** ((n - 69) / 12)
def env(a, b, att=0.05, rel=0.3):
    e = np.zeros(N); i0, i1 = int(max(0, a) * SR), int(min(b, DUR) * SR)
    if i1 <= i0: return e
    seg = np.arange(i1 - i0) / SR; ln = (i1 - i0) / SR
    e[i0:i1] = np.minimum(1, seg / att) * np.minimum(1, np.maximum(0, (ln - seg) / rel)); return e
def spec_filter(x, fn):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X *= fn(f); return np.fft.irfft(X, len(x))
lowpass = lambda x, fc: spec_filter(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** 4))
bandpass = lambda x, lo, hi: spec_filter(x, lambda f: ((f > lo) & (f < hi)).astype(float))
def add(sig, a, pan=0.5, amp=1.0):
    i0 = int(a * SR); n = min(len(sig), N - i0)
    if n <= 0: return
    L[i0:i0 + n] += sig[:n] * amp * (1 - pan) * 2 ** 0.5; R[i0:i0 + n] += sig[:n] * amp * pan * 2 ** 0.5

# ---------- pad: chords per section ----------
CH = [(0, 6.0, [50, 57, 62, 65], 0.5), (6.0, 12.3, [38, 45, 50, 53, 56], 0.8),   # Dm, then a darker Dm(b6) colour in the dark scene
      (12.3, 19.0, [46, 53, 57, 62], 0.55), (19.0, 25.3, [43, 50, 55, 58], 0.5), (25.3, 29.6, [45, 52, 57, 61, 64], 0.7),  # Bb, Gm, A (tension)
      (29.6, 37.0, [41, 48, 57, 60, 64, 67], 1.0), (37.0, 46.0, [46, 53, 57, 60, 65], 0.8)]   # F add9 bloom, Bbmaj9
prog = [[38, 50, 57, 62, 65], [46, 50, 57, 62, 65], [41, 53, 57, 60, 65], [48, 52, 55, 60, 64]]   # Dm Bb F C, 4 s each
x = 46.0
while x < 113.0:
    i = int((x - 46.0) / 4) % 4; CH.append((x, min(x + 4, 113.0), prog[i], 0.75)); x += 4
CH += [(113.0, 117.0, [46, 53, 57, 60, 65], 0.8), (117.0, 120.0, [41, 48, 55, 57, 64, 69], 1.0)]
pad = np.zeros(N); padR = np.zeros(N)
for a, b, notes, amp in CH:
    e = env(a - 0.1, b + 0.4, att=0.35 if a else 2.0, rel=0.5) * amp
    for k, n in enumerate(notes):
        f = hz(n)
        for d, pan in ((-0.1, 0.25), (0.1, 0.75)):
            ph = 2 * np.pi * f * (1 + d / 100) * t + k * 1.3
            s = np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
            pad += s * e * (1 - pan); padR += s * e * pan
cut = np.where((t > 6.0) & (t < 12.3), 700, 1500)          # the dark scene is muffled
pad = lowpass(pad, 1500) * 0.017; padR = lowpass(padR, 1500) * 0.017
breath = 0.8 + 0.2 * np.sin(2 * np.pi * 0.25 * t)
L += pad * breath; R += padR * breath

# ---------- percussion ----------
def kick(a, amp=0.3, f0=120, f1=42, dec=0.26):
    ln = int(0.7 * SR); tt = np.arange(ln) / SR; f = f1 + (f0 - f1) * np.exp(-tt / 0.035); ph = 2 * np.pi * np.cumsum(f) / SR
    add(np.sin(ph) * np.exp(-tt / dec), a, 0.5, amp)
noise = rng.standard_normal(N)
hatsrc = bandpass(noise, 7000, 15000)
def hat(a, amp=0.02, dec=0.035):
    i0 = int(a * SR); ln = int(0.15 * SR)
    if i0 + ln > N: return
    tt = np.arange(ln) / SR; s = hatsrc[i0:i0 + ln] * np.exp(-tt / dec); add(s, a, 0.62, amp)
def clickf(a, amp=0.05, f=2400, pan=0.5):
    ln = int(0.05 * SR); tt = np.arange(ln) / SR; add(np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.006) + 0.4 * rng.standard_normal(ln) * np.exp(-tt / 0.003), a, pan, amp)
def bell(a, n, amp=0.05, dec=1.0, pan=0.5):
    ln = int(min(DUR - a, dec * 4) * SR); tt = np.arange(ln) / SR; f = hz(n)
    s = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2.01 * tt) + 0.1 * np.sin(2 * np.pi * f * 3.99 * tt)) * np.exp(-tt / dec) * np.minimum(1, tt / 0.003)
    add(s, a, pan, amp)
def thud(a, amp=0.4): kick(a, amp, 90, 36, 0.45)
def whoosh(a, amp=0.06, ln=0.6, lo=300, hi=5000):
    e = np.zeros(N); i0, i1 = int((a - ln / 2) * SR), int((a + ln / 2) * SR); i0 = max(0, i0); x = np.linspace(0, 1, i1 - i0); e[i0:i1] = np.sin(np.pi * x) ** 2
    s = bandpass(noise, lo, hi) * e * amp; L[:] += s; R[:] += s * 0.9
def riser(a, b, amp=0.045):
    e = np.zeros(N); i0, i1 = int(a * SR), int(b * SR); e[i0:i1] = np.linspace(0, 1, i1 - i0) ** 2.4
    s = bandpass(noise, 1800, 9000) * e * amp; L[:] += s; R[:] += s
def hit(a, amp=0.5):
    kick(a, amp, 150, 32, 0.8); whoosh(a + 0.15, 0.05, 0.6, 2000, 9000)

# Act I
for a in (0.4, 1.55, 2.7): bell(a + 0.25, 74, 0.03, 0.6, 0.55); clickf(a + 0.25, 0.04)
for k in range(26): clickf(0.45 + k * 0.036, 0.012, 3200, 0.6)            # the counter ticking up
for i, n in enumerate([62, 65, 69]): bell(4.05 + i * 0.5, n, 0.025, 1.4, 0.4)
riser(4.8, 6.0, 0.035); hit(6.0, 0.45)
for k in np.arange(6.0, 12.0, 1.0): kick(k, 0.12, 70, 40, 0.3); kick(k + 0.25, 0.07, 70, 40, 0.25)   # heartbeat in the dark
for a in (6.8, 8.55, 10.3): thud(a, 0.3); whoosh(a - 0.1, 0.04, 0.4)
whoosh(12.2, 0.07, 1.0); riser(11.4, 12.2, 0.03)
for i in range(16): clickf(12.35 + (i % 8) * 0.08 + (i // 8) * 0.25 + 0.4, 0.02, 1800 + i * 60, 0.3 + (i % 4) * 0.12)
for a in (16.6, 16.75): bell(a, 57, 0.03, 0.5, 0.5)
whoosh(18.9, 0.09, 0.7)
for k in np.arange(19.5, 21.4, 0.5): clickf(k, 0.025, 1200, 0.7)          # the solo clock
clickf(21.8, 0.05, 900); clickf(22.5, 0.05, 1100)
for a in (23.3, 23.7, 24.1): thud(a, 0.42)
riser(26.5, 29.6, 0.05)
# Act II
hit(29.6, 0.6)
for i, n in enumerate([65, 69, 72, 76, 79, 84]): bell(29.7 + i * 0.12, n, 0.028, 1.8, 0.3 + 0.08 * i)
bell(32.95, 81, 0.035, 1.6); bell(33.1, 84, 0.025, 1.6)
whoosh(36.9, 0.08, 0.8)
for a in (37.2, 38.3, 39.4): bell(a, 72, 0.02, 0.8, 0.6)
for k in np.arange(41.0, 46.0, 0.5): kick(k, 0.12)
for a in (42.3, 42.55, 42.8): clickf(a, 0.04, 1600)
whoosh(46.0, 0.07, 0.7)
# Act III: driving section
bassline = []
for k in np.arange(46.0, 113.0, 0.5):
    if 81.5 < k < 82.0: continue
    dark = 82.0 <= k < 95.7
    kick(k, 0.2 if not dark else 0.24)
    hat(k + 0.25, 0.018 if not dark else 0.012)
    if int((k - 46) * 2) % 4 == 2: hat(k, 0.008)
    i = int((k - 46.0) / 4) % 4; root = [38, 34, 41, 36][i]
    bassline.append((k, root))
bass = np.zeros(N)
for k, root in bassline:
    for off in (0.0, 0.25):
        i0 = int((k + off) * SR); ln = int(0.22 * SR); tt = np.arange(ln) / SR
        if i0 + ln < N: bass[i0:i0 + ln] += np.sin(2 * np.pi * hz(root) * tt) * np.exp(-tt / 0.12) * (1 if off == 0 else 0.6)
bass = lowpass(bass, 400) * 0.11; L += bass; R += bass
for a in (58.15, 60.45, 75.25, 75.95): clickf(a, 0.07, 2000, 0.6)                    # cursor clicks
for i in range(7): clickf(77.4 + i * 0.25, 0.04, 1500 + i * 120, 0.55); bell(77.4 + i * 0.25, 74 + [0, 2, 5, 7, 9, 12, 14][i], 0.012, 0.3)
for a in (56.0, 65.6, 73.6, 96.0, 105.6): whoosh(a, 0.06, 0.8)                        # window moves between chapters
riser(80.6, 82.0, 0.05); hit(82.0, 0.55)
for a, pan in ((83.2, 0.3), (84.6, 0.7), (86.6, 0.7), (87.2, 0.3), (89.8, 0.7), (91.8, 0.3), (93.0, 0.7)): clickf(a, 0.04, 1300, pan)
whoosh(93.2, 0.07, 1.0, 1200, 9000); whoosh(95.3, 0.05, 0.6)
whoosh(96.1, 0.08, 1.0)
for a in (97.0, 99.4, 100.8, 102.3, 103.4, 104.4): bell(a, 76, 0.016, 0.5, 0.6)
bell(98.5, 81, 0.03, 1.2); bell(98.6, 84, 0.02, 1.2)
bell(107.6, 81, 0.03, 1.0); thud(108.4, 0.18)
for i in range(4): bell(109.9 + i * 0.56, [62, 65, 69, 74][i], 0.025, 1.0, 0.35 + i * 0.1)
hit(111.6, 0.35); bell(111.65, 86, 0.03, 1.6)
# Act IV
for i, a in enumerate((113.5, 113.7, 113.9)): clickf(a, 0.03, 1400)
riser(115.5, 117.0, 0.045); hit(117.0, 0.55)
for i, n in enumerate([65, 72, 76, 79, 84, 88]): bell(117.1 + i * 0.1, n, 0.026, 2.0, 0.3 + 0.08 * i)
whoosh(118.9, 0.06, 1.0); L += np.sin(2 * np.pi * hz(29) * t) * env(117.0, 120.0, 0.05, 2.0) * 0.1; R += np.sin(2 * np.pi * hz(29) * t) * env(117.0, 120.0, 0.05, 2.0) * 0.1

fade = np.minimum(1, np.minimum(t / 0.4, (DUR - t) / 0.6))
st = np.stack([L, R], 1) * fade[:, None]; st /= np.max(np.abs(st)) / 0.89
with wave.open('soundtrack.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st * 32767).astype(np.int16).tobytes())
print('ok', DUR)
