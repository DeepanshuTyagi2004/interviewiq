import { blinks, bump, eio, lerp, mix, quad, r, seg, track, type Point } from "../motion";
import { fill, shape, stroke } from "../palette";
import { applyPose, idlePose, stroll, toWorld, WAVE_PAW } from "../pose";
import { AlertBubble, popBubble, Sparkle, ThoughtCloud, showThought, twinkle } from "../props";
import type { Scene } from "./types";

/**
 * Note-taker (writing the interviewer's notes): clipboard hugged to its tummy, tongue out, the cat
 * writes as it paces up and down, ticking each line. It stops with the pencil to its lips to think,
 * gets an idea, adds one more line and a little heart, then walks over and pins the note to the board.
 * The "writing" is scribble, never words.
 */
interface Line {
  y: number;
  x0: number;
  x1: number;
}
/** Lines on the clipboard, in the cat's own coordinates. */
const LINES: Line[] = [
  { y: 164, x0: 83, x1: 118 },
  { y: 175, x0: 83, x1: 110 },
  { y: 186, x0: 83, x1: 120 },
  { y: 197, x0: 83, x1: 104 },
];
const WRITE: [number, number][] = [
  [0.5, 1.8],
  [2.25, 3.45],
  [4.2, 5.4],
  [7.7, 8.7],
];
const TICK: [number, number][] = [
  [1.9, 2.1],
  [3.55, 3.75],
  [7.4, 7.6],
  [8.8, 9.0],
];
const THINK: [number, number] = [5.6, 7.0];
const IDEA = 7.0;
const HEART: [number, number] = [9.1, 9.6];
const HEART_AT: Point = { x: 113, y: 198 };
const PIN = 10.3;
const BOARD = { x: 236, y: 60, w: 90, h: 96 };
const NOTE_AT: Point = { x: 288, y: 120 };
const WALK: [number, number][] = [
  [0.4, -10],
  [3.8, 110],
  [4.2, 110],
  [5.6, 40],
  [9.6, 40],
  [PIN, 100],
];
/** Pencil angles: writing (tip down-left of the paw) and thinking (tip at the lips). */
const WRITE_ANGLE = 140;
const THINK_ANGLE = 200;
const GRIP = 31;

/** Small handwriting-like humps along a line, varied but deterministic. */
function scribble({ x0, x1, y }: Line, seed: number): string {
  let d = `M${x0} ${y}`;
  let x = x0;
  let i = 0;
  while (x < x1 - 3) {
    const w = 3 + ((seed * 7 + i * 3) % 3);
    const h = (i + seed) % 5 === 0 ? 4.5 : 2 + ((seed + i * 5) % 3) * 0.8;
    const gap = (i + seed) % 6 === 5 ? 3 : 0;
    if (gap) d += ` m${gap} 0`;
    d += ` q${w / 2} ${-h} ${w} 0`;
    x += w + gap;
    i++;
  }
  return d;
}

const tickPoints = (y: number): Point[] => [
  { x: 73, y: y - 1 },
  { x: 75.5, y: y + 1.8 },
  { x: 80, y: y - 4 },
];

function heartPoint(p: number): Point {
  const a = Math.PI * 2 * p;
  return {
    x: HEART_AT.x + 0.32 * 16 * Math.pow(Math.sin(a), 3),
    y: HEART_AT.y - 0.32 * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)),
  };
}
const HEART_PATH = Array.from({ length: 41 }, (_, i) => heartPoint(i / 40))
  .map((p, i) => `${i ? "L" : "M"}${r(p.x)} ${r(p.y)}`)
  .join(" ");

const lineTip = (l: Line, p: number): Point => {
  const x = lerp(l.x0, l.x1, p);
  return { x, y: l.y - Math.abs(Math.sin(((x - l.x0) / 4) * Math.PI)) * 2 };
};
const alongTick = (y: number, p: number): Point => {
  const [a, b, c] = tickPoints(y);
  return p < 0.35 ? mix(a!, b!, p / 0.35) : mix(b!, c!, (p - 0.35) / 0.65);
};
const start = (i: number): Point => ({ x: LINES[i]!.x0, y: LINES[i]!.y });
const tickEnd = (i: number): Point => tickPoints(LINES[i]!.y)[2]!;
const tickStart = (i: number): Point => tickPoints(LINES[i]!.y)[0]!;
const AT_LIPS: Point = { x: 101, y: 135 };
const TUCKED: Point = { x: 96, y: 152 };

/** The pencil tip on the clipboard, in the cat's own coordinates. */
function tipAt(t: number): Point {
  for (let i = 0; i < 4; i++) {
    const [a, b] = WRITE[i]!;
    if (t >= a && t <= b) return lineTip(LINES[i]!, eio(seg(t, a, b)));
    const [ta, tb] = TICK[i]!;
    if (t >= ta && t <= tb) return alongTick(LINES[i]!.y, seg(t, ta, tb));
  }
  if (t >= HEART[0] && t <= HEART[1]) return heartPoint(seg(t, HEART[0], HEART[1]));
  if (t >= THINK[0] + 0.3 && t < THINK[1] - 0.2) return { x: AT_LIPS.x, y: AT_LIPS.y + Math.abs(Math.sin(t * 9)) * 2.5 };
  return track(t, [
    [0, { x: 86, y: 158 }],
    [0.5, start(0)],
    [1.8, lineTip(LINES[0]!, 1)],
    [1.9, tickStart(0)],
    [2.1, tickEnd(0)],
    [2.25, start(1)],
    [3.45, lineTip(LINES[1]!, 1)],
    [3.55, tickStart(1)],
    [3.75, tickEnd(1)],
    [4.2, start(2)],
    [5.4, lineTip(LINES[2]!, 1)],
    [THINK[0] + 0.3, AT_LIPS],
    [THINK[1] - 0.2, AT_LIPS],
    [7.4, tickStart(2)],
    [7.6, tickEnd(2)],
    [7.7, start(3)],
    [8.7, lineTip(LINES[3]!, 1)],
    [8.8, tickStart(3)],
    [9.0, tickEnd(3)],
    [9.1, heartPoint(0)],
    [9.6, heartPoint(1)],
    [9.9, TUCKED],
  ]);
}

const angleAt = (t: number) =>
  lerp(WRITE_ANGLE, THINK_ANGLE, Math.min(eio(seg(t, THINK[0], THINK[0] + 0.3)), 1 - eio(seg(t, THINK[1] - 0.2, THINK[1] + 0.1))));
const writing = (t: number) => WRITE.some(([a, b]) => t >= a && t <= b) || TICK.some(([a, b]) => t >= a && t <= b) || (t >= HEART[0] && t <= HEART[1]);

export const noteTaker: Scene = {
  id: "note-taker",
  duration: 12,
  still: 6.3,
  accessory: "none",

  back: () => (
    <g>
      <rect x={BOARD.x} y={BOARD.y} width={BOARD.w} height={BOARD.h} rx="8" style={fill("wood")} />
      <rect x={BOARD.x + 6} y={BOARD.y + 6} width={BOARD.w - 12} height={BOARD.h - 12} rx="4" style={fill("paper-back")} />
      <g transform={`translate(${BOARD.x + 26} ${BOARD.y + 26}) rotate(-5)`}>
        <rect x="-13" y="-13" width="26" height="26" rx="2" style={fill("highlight")} />
        <line x1="-8" y1="-3" x2="8" y2="-3" style={stroke("gold", 2)} />
        <line x1="-8" y1="4" x2="4" y2="4" style={stroke("gold", 2)} />
        <circle cx="0" cy="-10" r="2.6" style={fill("fur")} />
      </g>
      <g transform={`translate(${BOARD.x + 64} ${BOARD.y + 32}) rotate(6)`}>
        <rect x="-12" y="-12" width="24" height="24" rx="2" style={fill("sky")} />
        <line x1="-7" y1="-2" x2="7" y2="-2" style={stroke("shine", 2, { strokeOpacity: 0.7 })} />
        <circle cx="0" cy="-9" r="2.6" style={fill("fur-deep")} />
      </g>
      <line x1={BOARD.x + 14} y1={BOARD.y + 74} x2={BOARD.x + 40} y2={BOARD.y + 74} style={stroke("rule-strong", 2.5)} />
    </g>
  ),

  held: () => (
    <g>
      <rect x="66" y="146" width="60" height="66" rx="5" style={fill("wood")} />
      <rect x="70" y="153" width="52" height="55" rx="3" style={shape("paper", "paper-edge", 1)} />
      <rect x="86" y="142" width="20" height="8" rx="3" style={fill("metal")} />
      {LINES.map((l, i) => (
        <g key={l.y}>
          <rect x="72" y={l.y - 5} width="8" height="8" rx="2" style={stroke("rule-strong", 1.2)} />
          <path data-part={`ink${i}`} d={scribble(l, i + 1)} pathLength={1} strokeDasharray="1 2" strokeDashoffset={1} opacity="0" style={stroke("ink", 1.6)} />
          <path
            data-part={`tick${i}`}
            d={tickPoints(l.y)
              .map((p, j) => `${j ? "L" : "M"}${p.x} ${p.y}`)
              .join(" ")}
            pathLength={1}
            strokeDasharray="1 2"
            strokeDashoffset={1}
            opacity="0"
            style={stroke("fur", 2)}
          />
        </g>
      ))}
      <path data-part="heart" d={HEART_PATH} pathLength={1} strokeDasharray="1 2" strokeDashoffset={1} opacity="0" style={stroke("fur", 1.8)} />
      {/* The other paw, holding the clipboard's edge. */}
      <circle cx="66" cy="182" r="8" style={fill("fur")} />
      <circle cx="69" cy="178.5" r="1.4" style={fill("pink")} />
      <circle cx="70.5" cy="182.5" r="1.4" style={fill("pink")} />
    </g>
  ),

  inHand: () => (
    <g data-part="pencil">
      <rect x="-52" y="-5.5" width="40" height="11" style={fill("gold")} />
      <line x1="-52" y1="0" x2="-12" y2="0" style={stroke("fur-dark", 1.2, { strokeOpacity: 0.35 })} />
      <path d="M0 0 L-12 -5.5 L-12 5.5 Z" style={fill("cream")} />
      <path d="M0 0 L-4.4 -2 L-4.4 2 Z" style={fill("ink")} />
      <rect x="-58" y="-5.5" width="6.5" height="11" style={fill("metal")} />
      <rect x="-66" y="-5.5" width="9" height="11" rx="3.5" style={fill("pink")} />
    </g>
  ),

  over: () => (
    <>
      <g data-part="note" opacity="0">
        <rect x="-13" y="-13" width="26" height="26" rx="2" style={fill("cream")} />
        <path d="M-8 -3 q2 -3 4 0 t4 0 t4 0" style={stroke("ink", 1.4)} />
        <path d="M-8 4 q2 -3 4 0 t4 0" style={stroke("ink", 1.4)} />
        <circle data-part="notePin" cx="0" cy="-10" r="2.8" opacity="0" style={fill("fur")} />
      </g>
      <ThoughtCloud />
      <AlertBubble />
      <Sparkle part="spark0" />
      <Sparkle part="spark1" tone="gold" size={0.8} />
      <Sparkle part="spark2" size={0.7} />
    </>
  ),

  frame(t, s) {
    const draw = (part: string, p: number) => {
      s.set(part, "stroke-dashoffset", 1 - p);
      s.set(part, "opacity", p > 0 ? 1 : 0);
    };
    WRITE.forEach(([a, b], i) => draw(`ink${i}`, eio(seg(t, a, b))));
    TICK.forEach(([a, b], i) => draw(`tick${i}`, seg(t, a, b)));
    draw("heart", seg(t, HEART[0], HEART[1]));

    const pose = idlePose(t);
    stroll(pose, t, WALK);
    let tip = tipAt(t);
    const angle = angleAt(t);
    const wiggle = writing(t) ? Math.sin(t * 30) * 3 : 0;
    const rad = ((angle + wiggle) * Math.PI) / 180;
    pose.paw = { x: tip.x - Math.cos(rad) * GRIP, y: tip.y - Math.sin(rad) * GRIP };
    // Pinning it up: the paw flicks up (pencil and all) to toss the note.
    if (t >= PIN && t < PIN + 0.5) {
      pose.paw = mix(pose.paw, WAVE_PAW, Math.sin(Math.PI * seg(t, PIN, PIN + 0.5)));
      tip = { x: pose.paw.x + Math.cos(rad) * GRIP, y: pose.paw.y + Math.sin(rad) * GRIP };
    }
    s.set("pencil", "transform", `translate(${r(tip.x)} ${r(tip.y)}) rotate(${r(angle + wiggle)})`);

    const thinking = t >= THINK[0] && t < THINK[1];
    const idea = bump(t, IDEA, 0.08, 0.25, 0.12);
    if (writing(t)) {
      pose.lid = 0.38;
      pose.mouth = "blep";
      pose.lookX = 0.6;
      pose.lookY = 2.2;
      pose.tilt += 4;
    } else if (t < THINK[0]) {
      pose.lookY = 1.5;
    }
    if (thinking) {
      pose.lookX = 1.4;
      pose.lookY = -2.4;
      pose.lid = 0.2;
      pose.tilt = -7 * eio(seg(t, THINK[0], THINK[0] + 0.3));
      pose.mouth = "w";
      pose.tail = Math.sin(t * 1.5) * 12;
      pose.droop = 0.2;
    }
    if (idea > 0) {
      pose.eyeScale = 1 + 0.25 * idea;
      pose.perk = idea;
      pose.mouth = "grin";
      pose.lid = 0;
      pose.lookX = 0;
      pose.lookY = 0;
      pose.y -= Math.sin(Math.PI * seg(t, IDEA, IDEA + 0.35)) * 8;
    }
    // Pinning it up: a little toss, then a proud wink.
    if (t >= PIN && t < PIN + 0.5) {
      pose.mouth = "o";
      pose.lookX = 2.6;
      pose.lookY = -1.5;
    }
    if (t >= PIN + 0.5) {
      pose.eyes = "wink";
      pose.mouth = "grin";
      pose.blush = 1;
      pose.lookX = 0;
      pose.lookY = 0.8;
      pose.tail = Math.sin(t * 12) * 14;
      pose.y -= Math.sin(Math.PI * seg(t, PIN + 0.5, PIN + 0.85)) * 5;
    }
    if (pose.eyes === "open") pose.lid = Math.max(pose.lid, 0.9 * blinks(t, [0.2, 4.0, 9.8]));
    applyPose(s, pose);

    // The note flies from the clipboard to the board and gets a pin.
    const from = toWorld(pose, { x: 96, y: 175 });
    const p = eio(seg(t, PIN, PIN + 0.5));
    const note = t < PIN ? from : quad(from, { x: (from.x + NOTE_AT.x) / 2, y: 40 }, NOTE_AT, p);
    const k = t < PIN ? 0 : t < PIN + 0.5 ? lerp(0.6, 1, p) : 1;
    s.set("note", "transform", `translate(${r(note.x)} ${r(note.y)}) rotate(${r(lerp(-20, -4, p))}) scale(${r(k)})`);
    s.set("note", "opacity", t < PIN ? 0 : 1);
    s.set("notePin", "opacity", t >= PIN + 0.5 ? 1 : 0);

    showThought(s, "think", t, THINK[0], THINK[1] + 0.05, toWorld(pose, { x: 140, y: 56 }), pose.flip);
    popBubble(s, "bubble", t, IDEA, IDEA + 0.6, toWorld(pose, { x: 146, y: 54 }));
    twinkle(s, ["spark0", "spark1", "spark2"], [
      [NOTE_AT.x - 22, NOTE_AT.y - 18],
      [NOTE_AT.x + 22, NOTE_AT.y - 8],
      [NOTE_AT.x + 4, NOTE_AT.y + 22],
    ], t, PIN + 0.45);
  },

  status: (t) =>
    t < 2.25
      ? "Taking notes on your projects"
      : t < THINK[0]
        ? "Writing follow-up questions"
        : t < IDEA
          ? "Thinking it over"
          : t < 9.6
            ? "Adding one more"
            : t < PIN + 0.5
              ? "Pinning it up"
              : "All noted",
};
