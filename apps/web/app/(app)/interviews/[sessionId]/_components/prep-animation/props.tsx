import { back, eio, r, seg } from "./motion";
import { c, fill, stroke } from "./palette";
import type { Stage } from "./stage";

/** Small pieces several scenes share: the "!" bubble, a thought cloud and sparkles. */

export function AlertBubble({ part = "bubble" }: { part?: string }) {
  return (
    <g data-part={part} transform="scale(0)">
      <path d="M-6 9 L-12 17 L1 11 Z" style={fill("bubble")} />
      <circle cx="0" cy="0" r="12.5" style={fill("bubble")} />
      <line x1="0" y1="-6.5" x2="0" y2="1.5" style={stroke("bubble-ink", 3.6)} />
      <circle cx="0" cy="6.2" r="2" style={fill("bubble-ink")} />
    </g>
  );
}

/** Pops the "!" bubble in at `a`, out at `b`. */
export function popBubble(s: Stage, part: string, t: number, a: number, b: number, at: { x: number; y: number }): void {
  const k = t < a || t > b ? 0 : back(seg(t, a, a + 0.22)) * (t > b - 0.2 ? 1 - eio(seg(t, b - 0.2, b)) : 1);
  s.set(part, "transform", `translate(${r(at.x)} ${r(at.y)}) scale(${r(k)})`);
}

/** A thought cloud with three dots that pulse in turn. */
export function ThoughtCloud({ part = "think" }: { part?: string }) {
  const cloud = { fill: c("paper"), stroke: c("line"), strokeWidth: 1.8 };
  return (
    <g data-part={part} transform="scale(0)">
      <circle cx="-22" cy="30" r="2.6" style={cloud} />
      <circle cx="-15" cy="20" r="3.8" style={cloud} />
      <ellipse cx="0" cy="0" rx="20" ry="13" style={cloud} />
      {[-8, 0, 8].map((x, i) => (
        <circle key={x} data-part={`${part}-dot${i}`} cx={x} cy="0" r="2" style={fill("ink")} />
      ))}
    </g>
  );
}

/** Shows the cloud from `a` to `b`; `flip` -1 mirrors it (trail to the right) for a cat facing left. */
export function showThought(s: Stage, part: string, t: number, a: number, b: number, at: { x: number; y: number }, flip: 1 | -1 = 1): void {
  const k = t < a || t > b ? 0 : back(seg(t, a, a + 0.25)) * (t > b - 0.2 ? 1 - eio(seg(t, b - 0.2, b)) : 1);
  s.set(part, "transform", `translate(${r(at.x)} ${r(at.y)}) scale(${r(k * flip)} ${r(k)})`);
  for (let i = 0; i < 3; i++) s.set(`${part}-dot${i}`, "opacity", 0.25 + 0.75 * Math.max(0, Math.sin(t * 7 - i * 0.9)));
}

const STAR = "M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z";

export function Sparkle({ part, tone = "fur", size = 1 }: { part: string; tone?: "fur" | "gold"; size?: number }) {
  return (
    <g data-part={part} transform="scale(0)">
      <path d={STAR} transform={`scale(${size})`} style={fill(tone)} />
    </g>
  );
}

/** Sparkles that twinkle out from `start`, one after another. */
export function twinkle(s: Stage, parts: string[], spots: [number, number][], t: number, start: number): void {
  parts.forEach((part, i) => {
    const a = start + i * 0.12;
    const p = seg(t, a, a + 0.6);
    const [x, y] = spots[i]!;
    s.set(part, "transform", `translate(${x} ${y}) rotate(${r(p * 90)}) scale(${r(Math.sin(Math.PI * p))})`);
  });
}
