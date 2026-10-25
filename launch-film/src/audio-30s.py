import numpy as np, wave
SR = 48000; DUR = 30.0; N = int(SR * DUR); t = np.arange(N) / SR
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)

def env(a, b, att=0.05, rel=0.3):
    e = np.zeros(N); i0, i1 = int(a * SR), int(min(b, DUR) * SR)
    seg = np.arange(i1 - i0) / SR; ln = (i1 - i0) / SR
    e[i0:i1] = np.minimum(1, seg / att) * np.minimum(1, np.maximum(0, (ln - seg) / rel)); return e

def lowpass(x, fc, q=None):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X *= 1 / np.sqrt(1 + (f / fc) ** 4); return np.fft.irfft(X, len(x))
def bandpass(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X *= ((f > lo) & (f < hi)); return np.fft.irfft(X, len(x))
def hz(n): return 440 * 2 ** ((n - 69) / 12)

# --- pad: warm detuned saw-ish chords, low-passed; chord per section
chords = [(0.0, 6.0, [50, 57, 60, 64, 69]),   # Dm9-ish
          (6.0, 13.0, [46, 53, 57, 62, 65]),  # Bbmaj7
          (13.0, 20.4, [43, 50, 53, 58, 62]), # Gm9
          (20.4, 28.0, [45, 53, 57, 60, 64]), # F/A
          (28.0, 30.0, [41, 48, 57, 60, 64, 67])]  # Fmaj9 resolve
pad = np.zeros(N); padR = np.zeros(N)
for a, b, notes in chords:
    e = env(max(0, a - 0.15), b + 0.35, att=0.6 if a else 2.5, rel=0.6)
    for k, n in enumerate(notes):
        f = hz(n)
        for d, pan in ((-0.12, 0.3), (0.12, 0.7)):
            ph = 2 * np.pi * f * (1 + d / 100) * t + k
            s = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
            pad += s * e * (1 - pan); padR += s * e * pan
pad = lowpass(pad, 1400) * 0.022; padR = lowpass(padR, 1400) * 0.022
breath = 0.75 + 0.25 * np.sin(2 * np.pi * 0.25 * t)
L += pad * breath; R += padR * breath

# --- arpeggio sparkle (orb / UI), pentatonic, light
def bell(at, n, amp=0.06, decay=1.2, pan=0.5):
    i0 = int(at * SR); ln = int(min(DUR - at, decay * 3) * SR); tt = np.arange(ln) / SR; f = hz(n)
    s = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2.01 * tt) + 0.12 * np.sin(2 * np.pi * f * 3.98 * tt)) * np.exp(-tt / decay) * np.minimum(1, tt / 0.004)
    L[i0:i0 + ln] += s * amp * (1 - pan) * 2; R[i0:i0 + ln] += s * amp * pan * 2
for i, n in enumerate([74, 77, 81, 84, 86]): bell(2.65 + i * 0.09, n, 0.03, 0.9, 0.3 + 0.1 * i)
for i in range(5): bell(7.6 + i * 0.22, [69, 72, 74, 76, 79][i], 0.028, 0.5, 0.65)  # sources connect
bell(12.05, 81, 0.03, 0.6); bell(21.65, 79, 0.03, 0.8); bell(21.75, 84, 0.025, 0.8)
for i, n in enumerate([65, 69, 72, 77]): bell(26.85 + i * 0.07, n + 12, 0.028, 1.0, 0.4 + 0.08 * i)
for i, n in enumerate([65, 72, 76, 79, 84]): bell(28.1 + i * 0.11, n, 0.03, 1.6, 0.3 + 0.1 * i)

# --- kick pulse (soft, 120 bpm) through the middle, plus big hits at cuts
def kick(at, amp=0.35, f0=110, f1=42, dec=0.28):
    i0 = int(at * SR); ln = int(0.6 * SR); tt = np.arange(ln) / SR
    if i0 + ln > N: ln = N - i0; tt = tt[:ln]
    f = f1 + (f0 - f1) * np.exp(-tt / 0.04); ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-tt / dec) * amp; L[i0:i0 + ln] += s; R[i0:i0 + ln] += s
beat = 0.5
for k in np.arange(6.0, 27.9, beat):
    if 12.6 < k < 13.0 or 19.9 < k < 20.4: continue
    kick(k, 0.16 if (k * 2) % 2 == 0 else 0.11)
hat = bandpass(rng.standard_normal(N), 7000, 16000)
hv = np.zeros(N)
for k in np.arange(6.25, 27.9, 0.5): hv += env(k, k + 0.06, 0.001, 0.05)
L += hat * hv * 0.012; R += hat * hv * 0.014
for at in (3.0, 13.0, 20.4, 28.0): kick(at, 0.55, 140, 34, 0.7)

# --- risers + whooshes
noise = rng.standard_normal(N)
def riser(a, b, amp=0.05):
    e = np.zeros(N); i0, i1 = int(a * SR), int(b * SR); e[i0:i1] = np.linspace(0, 1, i1 - i0) ** 2.2
    return bandpass(noise, 1500, 9000) * e * amp
def whoosh(at, amp=0.08, ln=0.5):
    e = np.zeros(N); i0, i1 = int((at - ln / 2) * SR), int((at + ln / 2) * SR); x = np.linspace(0, 1, i1 - i0); e[i0:i1] = np.sin(np.pi * x) ** 2
    return bandpass(noise, 300, 4000) * e * amp
for a, b in ((2.0, 3.0), (5.1, 6.0), (12.1, 13.0), (19.5, 20.4), (27.2, 28.0)):
    r = riser(a, b); L += r; R += r * 0.9
for at, amp in ((6.0, 0.06), (9.75, 0.07), (11.2, 0.05), (14.3, 0.08), (16.0, 0.04), (17.6, 0.04), (19.3, 0.05), (22.6, 0.04), (25.1, 0.06)):
    w = whoosh(at, amp); L += w; R += w

# soft sub swell under the end card
L += np.sin(2 * np.pi * hz(29) * t) * env(28.0, 30.0, 0.05, 1.5) * 0.12; R += np.sin(2 * np.pi * hz(29) * t) * env(28.0, 30.0, 0.05, 1.5) * 0.12

fade = np.minimum(1, np.minimum(t / 0.3, (DUR - t) / 0.4))
st = np.stack([L, R], 1) * fade[:, None]
st /= np.max(np.abs(st)) / 0.89
pcm = (st * 32767).astype(np.int16)
with wave.open('soundtrack.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('ok')
