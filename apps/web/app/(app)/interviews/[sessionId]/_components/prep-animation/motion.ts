/** Easing and timeline helpers shared by the prep-animation scenes. Times are in seconds. */

export interface Point {
  x: number;
  y: number;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** Ease in and out (quadratic). */
export const eio = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
/** Ease out (cubic). */
export const eout = (x: number) => 1 - Math.pow(1 - x, 3);
/** Ease out with a small overshoot: pops things into place. */
export const back = (x: number) => {
  const c1 = 1.7;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** 0 before `a`, 1 after `b`, linear in between. */
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

/** A pulse: eases up over `r` from `a`, holds for `h`, eases down over `f`. */
export function bump(t: number, a: number, r: number, h: number, f: number): number {
  if (t < a) return 0;
  if (t < a + r) return eio((t - a) / r);
  if (t < a + r + h) return 1;
  if (t < a + r + h + f) return 1 - eio((t - a - r - h) / f);
  return 0;
}

/** A blink (0 open → 1 shut) at each of the given times. */
export const blinks = (t: number, at: number[]) => Math.max(0, ...at.map((a) => bump(t, a, 0.07, 0.02, 0.07)));

export const mix = (a: Point, b: Point, p: number): Point => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) });

/** A point on the quadratic curve a → b bent towards `c`. */
export function quad(a: Point, c: Point, b: Point, p: number): Point {
  const q = 1 - p;
  return { x: q * q * a.x + 2 * q * p * c.x + p * p * b.x, y: q * q * a.y + 2 * q * p * c.y + p * p * b.y };
}

/** Keyframed point: holds the first and last keys, eases between neighbours. */
export function track(t: number, keys: [number, Point][]): Point {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, from] = keys[i]!;
    const [b, to] = keys[i + 1]!;
    if (t <= b) return mix(from, to, eio(seg(t, a, b)));
  }
  return keys[keys.length - 1]![1];
}

/** Round for attribute strings (keeps the DOM writes short and stable). */
export const r = (n: number) => Math.round(n * 100) / 100;
