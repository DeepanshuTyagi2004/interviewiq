"""Score for film.html (76 s): warm, minimal electronic in F major at 120 BPM.

Electric-piano chords, soft plucks, a round sub, light kick/snap/shaker with ducking, and a reverb bus.
Transitions are air swishes, glassy taps and shimmer, never booms. Cues are authored on the film's
120 s source timeline and mapped through the same retime table as film.html.
"""
import numpy as np, wave

SR = 48000
SPEED = [[0, 6, 1.5], [6, 12.3, 1.6], [12.3, 19, 1.8], [19, 25.3, 1.6], [25.3, 29.6, 1.5], [29.6, 37, 1.6], [37, 46, 1.45], [46, 113, 1.6], [113, 120, 1.45]]
STARTS = [0.0]
for a, b, v in SPEED: STARTS.append(STARTS[-1] + (b - a) / v)
DUR = STARTS[-1]
def F(ts):
    """Source time → film time."""
    for i, (a, b, v) in enumerate(SPEED):
        if ts <= b or i == len(SPEED) - 1: return STARTS[i] + (min(ts, b) - a) / v
N = int(SR * DUR) + SR; t = np.arange(N) / SR
rng = np.random.default_rng(5)

def hz(n): return 440.0 * 2 ** ((n - 69) / 12)
def spec(x, fn):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X *= fn(f); return np.fft.irfft(X, len(x))
def lp(x, fc): return spec(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** 4))
def hp(x, fc): return spec(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1)) ** 4))
def place(bus, sig, a, pan=0.5, amp=1.0):
    i0 = int(round(a * SR))
    if i0 < 0: sig = sig[-i0:]; i0 = 0
    n = min(len(sig), N - i0)
    if n <= 0: return
    bus[0][i0:i0 + n] += sig[:n] * amp * np.cos(pan * np.pi / 2); bus[1][i0:i0 + n] += sig[:n] * amp * np.sin(pan * np.pi / 2)
def bus(): return [np.zeros(N), np.zeros(N)]
KEYS, PLUCK, BASS, DRUM, PAD, SFX, BELL = bus(), bus(), bus(), bus(), bus(), bus(), bus()

# ---------- instruments ----------
def rhodes(n, dur=1.6, vel=1.0):
    ln = int(dur * SR); tt = np.arange(ln) / SR; f = hz(n)
    idx = 1.6 * np.exp(-tt / 0.25) + 0.25
    s = np.sin(2 * np.pi * f * tt + idx * np.sin(2 * np.pi * f * tt)) + 0.15 * np.sin(2 * np.pi * 2 * f * tt) * np.exp(-tt / 0.15)
    env = np.minimum(1, tt / 0.004) * np.exp(-tt / 1.1) * np.minimum(1, (dur - tt) / 0.08)
    return s * env * vel
def pluck(n, vel=1.0, bright=0.6, dec=0.24):
    ln = int(0.7 * SR); tt = np.arange(ln) / SR; f = hz(n)
    s = np.sin(2 * np.pi * f * tt) + bright * 0.5 * np.sin(4 * np.pi * f * tt) * np.exp(-tt / 0.06) + bright * 0.25 * np.sin(6 * np.pi * f * tt) * np.exp(-tt / 0.03)
    return s * np.minimum(1, tt / 0.002) * np.exp(-tt / dec) * vel
def sub(n, dur=0.24, vel=1.0):
    ln = int(dur * SR); tt = np.arange(ln) / SR
    return np.sin(2 * np.pi * hz(n) * tt) * np.minimum(1, tt / 0.006) * np.exp(-tt / 0.18) * np.minimum(1, (dur - tt) / 0.02) * vel
nz = rng.standard_normal(N)
snapsrc = spec(nz, lambda f: np.exp(-((np.log(np.maximum(f, 1)) - np.log(2600)) ** 2) / 0.35))
shksrc = hp(nz, 7000)
def kick(a, vel=1.0):
    ln = int(0.35 * SR); tt = np.arange(ln) / SR; f = 48 + 52 * np.exp(-tt / 0.03)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.15) + 0.15 * np.sin(2 * np.pi * 1800 * tt) * np.exp(-tt / 0.004)
    place(DRUM, s, a, 0.5, 0.2 * vel)
def snap(a, vel=1.0):
    i0 = int(a * SR); ln = int(0.18 * SR); tt = np.arange(ln) / SR
    if i0 < 0 or i0 + ln >= N: return
    s = snapsrc[i0:i0 + ln] * (np.exp(-tt / 0.05) + 0.6 * np.exp(-np.maximum(tt - 0.012, 0) / 0.04) * (tt > 0.012))
    place(DRUM, s * 0.2, a, 0.46, vel)
def shaker(a, vel=1.0):
    i0 = int(a * SR); ln = int(0.08 * SR); tt = np.arange(ln) / SR
    if i0 < 0 or i0 + ln >= N: return
    place(DRUM, shksrc[i0:i0 + ln] * np.minimum(1, tt / 0.008) * np.exp(-tt / 0.025) * 0.075 * vel, a, 0.62)
def bell(a, n, amp=0.05, dec=1.2, pan=0.5):
    ln = int(dec * 4 * SR); tt = np.arange(ln) / SR; f = hz(n)
    s = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt / 0.3) + 0.1 * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt / 0.1)) * np.exp(-tt / dec) * np.minimum(1, tt / 0.002)
    place(BELL, s, a, pan, amp * 1.8)

# ---------- transition sound design ----------
def swept(dur, f0, f1, q=6.0, shape=None, seed=0):
    """Noise through a resonant band-pass whose centre sweeps f0 → f1 (exponentially)."""
    ln = int(dur * SR); x = np.random.default_rng(seed).standard_normal(ln); y = np.zeros(ln)
    fc = f0 * (f1 / f0) ** (np.arange(ln) / ln); y1 = y2 = 0.0
    for i in range(ln):
        w = 2 * np.pi * fc[i] / SR; r = np.exp(-w / (2 * q)); y0 = (1 - r) * x[i] + 2 * r * np.cos(w) * y1 - r * r * y2; y2, y1 = y1, y0; y[i] = y0
    e = shape(np.arange(ln) / ln) if shape else np.sin(np.pi * np.arange(ln) / ln) ** 2
    return y * e / (np.max(np.abs(y)) + 1e-9)
def swish(a, amp=0.11, dur=0.42, up=True, pan_from=0.25, pan_to=0.75, seed=0):
    """An air swish centred on a: fast rise, softer tail, moving across the stereo field."""
    s = swept(dur, 700, 5200, 4.0, lambda x: np.minimum(1, x / 0.45) ** 2 * np.exp(-np.maximum(x - 0.45, 0) / 0.18), seed) if up else swept(dur, 5200, 900, 4.0, None, seed)
    i0 = int((a - dur * 0.45) * SR); n = min(len(s), N - i0); pan = np.linspace(pan_from, pan_to, n)
    SFX[0][i0:i0 + n] += s[:n] * amp * np.cos(pan * np.pi / 2); SFX[1][i0:i0 + n] += s[:n] * amp * np.sin(pan * np.pi / 2)
def tick(a, amp=0.05, pan=0.55, f=4200):
    ln = int(0.05 * SR); tt = np.arange(ln) / SR
    place(SFX, (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 1.5 * tt)) * np.exp(-tt / 0.008), a, pan, amp)
def tap(a, amp=0.07, pan=0.5, f=1250):
    ln = int(0.25 * SR); tt = np.arange(ln) / SR
    place(SFX, (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2.7 * tt) * np.exp(-tt / 0.02)) * np.minimum(1, tt / 0.001) * np.exp(-tt / 0.06), a, pan, amp)
def riser(a, b, amp=0.06, seed=1):
    s = swept(b - a, 400, 7000, 3.0, lambda x: x ** 2.2 * np.minimum(1, (1 - x) / 0.04), seed); place(SFX, s, a, 0.5, amp)
def reverse_swell(a, notes, dur=1.4, amp=0.06):
    ch = sum(rhodes(n, dur + 0.5, 0.6) for n in notes)[::-1][: int(dur * SR)]
    ch = ch * np.linspace(0, 1, len(ch)) ** 2; place(KEYS, ch, a - dur, 0.5, amp * 3)
def sub_swell(a, amp=0.25):
    ln = int(1.1 * SR); tt = np.arange(ln) / SR; f = 40 + 18 * np.exp(-tt / 0.25)
    place(DRUM, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(1, tt / 0.02) * np.exp(-tt / 0.45), a, 0.5, amp * 0.4)
def shimmer(a, notes, amp=0.035, spread=0.06):
    for i, n in enumerate(notes): bell(a + i * spread, n, amp, 1.4, 0.25 + 0.5 * i / max(1, len(notes) - 1))

# ---------- harmony + grid (anchored so the reveal lands on a downbeat) ----------
BEAT = 0.5; ANCHOR = F(29.6)              # the gold orb reveal
def beat_t(b): return ANCHOR + b * BEAT
CH_F = {'Fmaj9': [41, 52, 55, 57, 60, 64], 'Am7': [45, 52, 55, 60, 64], 'Dm9': [38, 53, 57, 60, 64], 'Bbmaj9': [46, 53, 57, 60, 62],
        'Gm9': [43, 53, 57, 58, 62], 'C6': [36, 52, 55, 57, 60], 'Asus': [45, 52, 57, 59, 64], 'Bbmaj7': [46, 53, 57, 62, 65]}
INTRO = ['Dm9', 'Bbmaj7', 'Gm9', 'Asus']
MAIN = ['Fmaj9', 'Am7', 'Dm9', 'Bbmaj9']
DARK = ['Dm9', 'Bbmaj9', 'Gm9', 'Asus']

def bar_start(k): return ANCHOR + k * 4 * BEAT
first_bar = int(np.floor((0 - ANCHOR) / 2.0))
last_bar = int(np.ceil((DUR - ANCHOR) / 2.0))
reveal_end = F(37.0); act3 = F(46.0); dark_a, dark_b = F(82.0), F(95.7); outro = F(113.0); end_logo = F(117.1)
for k in range(first_bar, last_bar):
    b0 = bar_start(k)
    if b0 + 2.0 < 0 or b0 > DUR: continue
    if b0 < ANCHOR - 0.01: name = INTRO[(k - first_bar) % 4]; sec = 'intro'
    elif b0 < reveal_end - 0.6: name = 'Fmaj9' if b0 < ANCHOR + 2 else 'Bbmaj9'; sec = 'reveal'
    elif b0 >= end_logo - 1.0: name = 'Fmaj9'; sec = 'end'
    elif b0 >= outro - 0.5: name = 'Bbmaj9' if k % 2 else 'Dm9'; sec = 'outro'
    elif dark_a - 0.8 <= b0 < dark_b - 0.8: name = DARK[k % 4]; sec = 'dark'
    else: name = MAIN[k % 4]; sec = 'groove' if b0 >= act3 - 0.5 else 'pre'
    ch = CH_F[name]; root = ch[0]
    # electric piano: whole-bar chord in intro/reveal/outro, off-beat stabs in the groove
    if sec in ('intro', 'reveal', 'outro', 'end'):
        for n in ch[1:]: place(KEYS, rhodes(n + 12 if n < 60 else n, 2.2 if sec != 'end' else 3.0, 0.55), b0, 0.35 + (n % 5) * 0.07, 0.1)
    else:
        for bt in (0.5, 1.5, 2.5, 3.5) if sec != 'dark' else (0.5, 2.5):
            for n in ch[1:]: place(KEYS, rhodes(n + 12, 0.42, 0.5), b0 + bt * BEAT, 0.3 + (n % 5) * 0.08, 0.075)
    # pad bed
    if sec != 'groove':
        ln = int(2.1 * SR); tt = np.arange(ln) / SR; env = np.minimum(1, tt / 0.5) * np.minimum(1, (2.1 - tt) / 0.5)
        pad = sum(np.sin(2 * np.pi * hz(n + 12) * tt * (1 + d)) for n in ch[1:4] for d in (-0.0015, 0.0015)) * env
        place(PAD, pad, b0, 0.5, 0.02 if sec != 'end' else 0.03)
    # plucks: 16th arpeggio (soft in intro, full in the groove, muted in the dark section)
    if sec in ('intro', 'pre', 'groove', 'dark', 'outro'):
        arp = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[4] + 12 if len(ch) > 4 else ch[1] + 24]
        steps = 16 if sec in ('groove', 'dark') else 8
        for s16 in range(steps):
            n = arp[(s16 * 3 + k) % len(arp)]; at = b0 + s16 * (2.0 / steps)
            vel = (0.9 if s16 % 4 == 0 else 0.55) * (0.6 if sec == 'intro' else 1.0)
            place(PLUCK, pluck(n, vel, 0.35 if sec in ('intro', 'dark') else 0.7), at, 0.2 + 0.6 * ((s16 % 4) / 3), 0.1)
    # sub bass
    if sec in ('pre', 'groove', 'dark', 'intro'):
        for e8 in range(8 if sec != 'intro' else 4):
            at = b0 + e8 * (0.25 if sec != 'intro' else 0.5)
            place(BASS, sub(root + 12 if root < 40 else root, 0.22 if sec != 'intro' else 0.4, 0.9 if e8 % 2 == 0 else 0.6), at, 0.5, 0.045 if sec != 'intro' else 0.03)
    # drums
    for bt in range(4):
        at = b0 + bt * BEAT
        if sec in ('groove', 'dark') or (sec == 'pre' and at >= F(37.0) + 1.0):
            kick(at, 0.9 if sec != 'pre' else 0.6)
            if bt in (1, 3) and sec != 'pre': snap(at, 0.9 if sec == 'groove' else 0.6)
        if sec in ('groove', 'dark', 'pre', 'intro'):
            for s in range(2 if sec == 'intro' else 4):
                shaker(at + s * (BEAT / (2 if sec == 'intro' else 4)), (1.0 if s == 2 else 0.55) * (0.6 if sec == 'intro' else 1))
        if sec == 'intro' and bt == 0: kick(at, 0.25)

# ---------- picture cues (source times from film.html) ----------
for a in (0.4, 1.55, 2.7): tap(F(a + 0.25), 0.06, 0.55, 1500)
for k in range(18): tick(F(0.45) + k * 0.035, 0.018, 0.6, 3800 + k * 30)
swish(F(5.9), 0.12, 0.5); sub_swell(F(6.05), 0.2)
for a in (6.8, 8.55, 10.3): swish(F(a), 0.06, 0.3, False, 0.6, 0.4, seed=int(a * 10)); tap(F(a + 0.15), 0.05, 0.5, 820)
swish(F(12.1), 0.12, 0.5, True, 0.3, 0.7, 2)
for i in range(16): tick(F(12.35 + (i % 8) * 0.08 + (i // 8) * 0.25 + 0.45), 0.02, 0.2 + (i % 5) * 0.15, 3000 + i * 90)
for a in (16.6, 16.7): tap(F(a), 0.05, 0.5, 980)
swish(F(18.95), 0.14, 0.38, True, 0.8, 0.1, 3)
for k in np.arange(19.6, 21.4, 0.55): tick(F(k), 0.02, 0.7, 2600)
tap(F(21.8), 0.07, 0.4, 1150); tap(F(22.5), 0.07, 0.62, 1350)
for i, a in enumerate((23.3, 23.7, 24.1)): tap(F(a), 0.09, 0.3 + 0.2 * i, 700); tick(F(a), 0.03, 0.5, 2200)
riser(F(26.6), ANCHOR, 0.05); reverse_swell(ANCHOR, CH_F['Fmaj9'][1:], 1.2, 0.05)
for a, b in ((28.1, 29.0),): swish(F(28.9), 0.08, 0.4, False, 0.3, 0.6, 4)
sub_swell(ANCHOR, 0.22); shimmer(ANCHOR + 0.02, [72, 76, 79, 81, 84, 88], 0.03)
tap(F(32.9), 0.06, 0.5, 1700); shimmer(F(33.1), [84, 88, 91], 0.02, 0.05)
swish(F(36.8), 0.12, 0.5, True, 0.2, 0.8, 5)
for a in (37.2, 38.3, 39.4): tick(F(a), 0.025, 0.6, 3400)
for a in (42.3, 42.55, 42.8): tap(F(a), 0.05, 0.5, 1400)
swish(F(45.9), 0.1, 0.45, True, 0.3, 0.7, 6)
for a in (46.3, 56.0, 65.6, 73.6, 96.0, 105.6): swish(F(a), 0.08, 0.36, True, 0.25, 0.75, int(a))
for a in (58.15, 60.45, 75.25, 75.95): tap(F(a), 0.08, 0.62, 1600); tick(F(a), 0.03, 0.62, 4800)
for i in range(7): tick(F(77.4 + i * 0.25), 0.035, 0.6, 3000 + i * 180)
riser(F(80.4), dark_a, 0.04, 7); swish(dark_a, 0.13, 0.55, True, 0.5, 0.5, 8); sub_swell(dark_a + 0.05, 0.16)
for a, pan in ((83.2, 0.3), (84.6, 0.7), (86.6, 0.7), (87.2, 0.3), (89.8, 0.7), (91.8, 0.3), (93.0, 0.7)): tap(F(a), 0.05, pan, 1250)
swish(F(93.2), 0.1, 0.7, True, 0.1, 0.9, 9); swish(F(95.3), 0.07, 0.5, False, 0.9, 0.1, 10)
swish(F(95.9), 0.12, 0.5, True, 0.3, 0.7, 11)
for a in (97.0, 99.4, 100.8, 102.3, 103.4, 104.4): tick(F(a), 0.03, 0.4, 3600)
shimmer(F(98.5), [81, 84, 88], 0.025, 0.04)
tap(F(107.6), 0.07, 0.6, 1500); tap(F(108.4), 0.05, 0.6, 900)
for i in range(4): bell(F(109.9 + i * 0.56), [72, 74, 77, 81][i], 0.025, 0.9, 0.3 + 0.13 * i)
shimmer(F(111.6), [77, 81, 84, 89], 0.03, 0.05)
for a in (113.5, 113.7, 113.9): tap(F(a), 0.045, 0.5, 1300)
riser(F(115.6), end_logo, 0.05, 12); reverse_swell(end_logo, CH_F['Fmaj9'][1:], 1.0, 0.04)
sub_swell(end_logo, 0.2); shimmer(end_logo + 0.02, [72, 76, 79, 84, 88, 91], 0.03, 0.07)
swish(F(118.8), 0.09, 0.6, True, 0.8, 0.2, 13)

# ---------- mix ----------
kicks = np.zeros(N)
for k in range(first_bar, last_bar):
    for bt in range(4):
        at = bar_start(k) + bt * BEAT
        if act3 - 0.5 <= at < outro - 0.5: i0 = int(at * SR); ln = int(0.3 * SR); kicks[i0:i0 + ln] = np.maximum(kicks[i0:i0 + ln], np.exp(-np.arange(ln) / SR / 0.11)) if i0 + ln < N else kicks[i0:i0 + ln]
duck = 1 - 0.45 * kicks
dark_env = np.clip(np.minimum((t - (dark_a - 0.6)) / 0.6, ((dark_b - 0.2) - t) / 0.6), 0, 1)
def darken(b):  # muffle the instruments while the interview room is dark
    return [x * (1 - dark_env) + lp(x, 900) * dark_env for x in b]
PLUCK = darken(PLUCK); KEYS = darken(KEYS)
dark_intro = np.clip(np.minimum((t - F(5.9)) / 0.3, (F(12.1) - t) / 0.3), 0, 1)
PLUCK = [x * (1 - dark_intro) + lp(x, 700) * dark_intro for x in PLUCK]

dry = [KEYS[i] * duck + PLUCK[i] * duck + BASS[i] * duck + PAD[i] * duck + DRUM[i] + SFX[i] + BELL[i] for i in range(2)]
send = [KEYS[i] * 0.5 + PLUCK[i] * 0.45 + PAD[i] * 0.6 + BELL[i] * 0.9 + SFX[i] * 0.35 + DRUM[i] * 0.05 for i in range(2)]
# stereo plate: decaying noise IR, darkened
irl = int(2.6 * SR); it = np.arange(irl) / SR
ir = [lp(np.random.default_rng(s).standard_normal(irl) * np.exp(-it / 0.6), 5000) for s in (21, 22)]
for c in ir: c[: int(0.012 * SR)] = 0
def conv(x, h):
    n = 1 << int(np.ceil(np.log2(len(x) + len(h)))); return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(h, n), n)[: len(x)]
wet = [conv(send[i], ir[i]) for i in range(2)]
wet = [w / (np.max(np.abs(w)) + 1e-9) * np.max(np.abs(send[i])) * 0.55 for i, w in enumerate(wet)]
mix = np.stack([hp(dry[i] + wet[i], 28) for i in range(2)], 1)[: int(DUR * SR)]
tt = np.arange(len(mix)) / SR
mix *= np.minimum(1, np.minimum(tt / 0.25, (DUR - tt) / 1.2))[:, None]
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.3) ; mix /= np.max(np.abs(mix)) / 0.9
with wave.open('soundtrack.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
print('ok', round(DUR, 2), 's')
