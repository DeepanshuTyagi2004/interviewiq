import { back, blinks, eio, lerp, quad, r, seg, track, type Point } from "../motion";
import { c, fill, shape, stroke } from "../palette";
import { applyPose, idlePose, laughing, lookAt, pawFromWorld, REST_PAW, stroll, toWorld, WAVE_PAW, type CatPose } from "../pose";
import type { Scene } from "./types";

/**
 * Warm-up (getting the interviewer ready): headset on, the cat walks over to its tea and sips it with
 * its eyes closed, then sings and dances across the floor. Its voice cracks, which makes it giggle,
 * and it finishes with a toothy wave and a wink.
 */
const STOOL_TOP = 166;
const MUG_HOME: Point = { x: 210, y: 152 };
/** Where the cat stands to reach the mug, and where the mug sits at its lips (its own coordinates). */
const STAND = 64;
const SIP: Point = { x: 112, y: 146 };
const SIP_TILT = -28;
/** The paw cradles the mug from below on the right, in the mug's own frame. */
const CRADLE: Point = { x: 6, y: 13 };
const SING: [number, number] = [4.2, 7.4];
const CRACK = 7.4;
const HELLO: [number, number] = [9.0, 11.2];
const WALK: [number, number][] = [
  [0, 0],
  [0.9, STAND],
  [4.3, STAND],
  [5.5, -20],
  [5.7, -20],
  [6.9, 40],
];
const MOUTH: Point = { x: 96, y: 138 };

function catAt(t: number): CatPose {
  const pose = idlePose(t);
  stroll(pose, t, WALK);
  return pose;
}

function mugAt(t: number, pose: CatPose): { pos: Point; rot: number } {
  if (t < 1.2 || t >= 3.6) return { pos: MUG_HOME, rot: 0 };
  const lips = toWorld(pose, SIP);
  if (t < 1.8) {
    const p = eio(seg(t, 1.2, 1.8));
    return { pos: quad(MUG_HOME, { x: 192, y: 112 }, lips, p), rot: lerp(0, SIP_TILT, p) };
  }
  if (t < 3.0) return { pos: { x: lips.x, y: lips.y + Math.sin((t - 1.8) * 4) * 1.2 }, rot: SIP_TILT + Math.sin((t - 1.8) * 4) * 2 };
  const p = eio(seg(t, 3.0, 3.6));
  return { pos: quad(lips, { x: 192, y: 112 }, MUG_HOME, p), rot: lerp(SIP_TILT, 0, p) };
}

function cradle(mug: { pos: Point; rot: number }): Point {
  const a = (mug.rot * Math.PI) / 180;
  return { x: mug.pos.x + CRADLE.x * Math.cos(a) - CRADLE.y * Math.sin(a), y: mug.pos.y + CRADLE.x * Math.sin(a) + CRADLE.y * Math.cos(a) };
}

function Note({ part }: { part: string }) {
  return (
    <g data-part={part} opacity="0">
      <ellipse cx="0" cy="0" rx="4.4" ry="3.3" transform="rotate(-20)" style={fill("line")} />
      <line x1="3.8" y1="-1" x2="3.8" y2="-15" style={stroke("line", 1.8)} />
      <path d="M3.8 -15 q 6.5 2 5 8.5" style={stroke("line", 1.8)} />
    </g>
  );
}

export const warmUp: Scene = {
  id: "warm-up",
  duration: 12,
  still: 9.8,
  accessory: "headset",

  back: () => (
    <g>
      <rect x="190" y={STOOL_TOP + 4} width="5" height="54" rx="2" style={fill("wood")} />
      <rect x="226" y={STOOL_TOP + 4} width="5" height="54" rx="2" style={fill("wood")} />
      <rect x="184" y={STOOL_TOP} width="54" height="8" rx="4" style={fill("wood")} />
    </g>
  ),

  front: () => (
    <g data-part="mug">
      {[0, 1, 2].map((i) => (
        <path key={i} data-part={`steam${i}`} d={`M${-6 + i * 6} -20 q -3.5 -5 0 -10 t 0 -10`} opacity="0" style={stroke("line", 2, { strokeOpacity: 0.45 })} />
      ))}
      <path d="M13 -7 C 22 -7, 22 7, 13 7" style={stroke("sky", 4)} />
      <rect x="-13" y="-14" width="26" height="28" rx="5" style={fill("sky")} />
      <rect x="-13" y="-3" width="26" height="6" style={fill("fur", { fillOpacity: 0.85 })} />
      <ellipse cx="0" cy="-14" rx="13" ry="3.5" style={shape("fur-deep", "sky", 1.5)} />
    </g>
  ),

  over: () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <Note key={i} part={`note${i}`} />
      ))}
      <path data-part="squeak" d="M-10 0 l4 -6 l4 8 l4 -8 l4 8 l4 -6" opacity="0" style={stroke("line", 2.4)} />
      <g data-part="hello" transform="scale(0)">
        <path d="M-12 11 L-21 25 L-3 13 Z" style={shape("paper", "line", 2)} />
        <rect x="-23" y="-14" width="46" height="28" rx="10" style={shape("paper", "line", 2)} />
        <path d="M-13 14 L-7.2 14" style={stroke("paper", 3)} />
        <text x="0" y="5" textAnchor="middle" style={{ fill: c("ink"), fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 14, fontWeight: 600 }}>
          hi!
        </text>
      </g>
    </>
  ),

  frame(t, s) {
    const pose = catAt(t);
    const mug = mugAt(t, pose);
    s.set("mug", "transform", `translate(${r(mug.pos.x)} ${r(mug.pos.y)}) rotate(${r(mug.rot)})`);
    for (let i = 0; i < 3; i++) {
      const phase = (t * 0.8 + i / 3) % 1;
      s.set(`steam${i}`, "transform", `translate(0 ${r(-phase * 9)})`);
      s.set(`steam${i}`, "opacity", Math.sin(phase * Math.PI) * 0.9);
    }

    // Sung notes float up from wherever the cat was when it sang them.
    for (let i = 0; i < 4; i++) {
      const born = SING[0] + 0.25 + i * 0.65;
      const p = seg(t, born, born + 1.4);
      const then = catAt(born);
      const from = toWorld(then, MOUTH);
      const at = { x: from.x + then.flip * 40 * p + Math.sin(p * 8) * 3, y: lerp(from.y, from.y - 70, eio(p)) };
      s.set(`note${i}`, "transform", `translate(${r(at.x)} ${r(at.y)}) rotate(${r(Math.sin(p * 6) * 12)}) scale(${r(0.8 + 0.3 * p)})`);
      s.set(`note${i}`, "opacity", p > 0 && p < 1 ? Math.sin(Math.PI * p) : 0);
    }
    const sq = seg(t, CRACK, CRACK + 0.6);
    const mouth = toWorld(pose, MOUTH);
    s.set("squeak", "transform", `translate(${r(mouth.x + 54 * pose.flip)} ${r(mouth.y - 12 - sq * 20)}) scale(${r(0.7 + sq * 0.5)})`);
    s.set("squeak", "opacity", sq > 0 && sq < 1 ? Math.sin(Math.PI * sq) : 0);

    const helloK = t < HELLO[0] + 0.1 || t > HELLO[1] ? 0 : back(seg(t, HELLO[0] + 0.1, HELLO[0] + 0.35)) * (t > HELLO[1] - 0.25 ? 1 - eio(seg(t, HELLO[1] - 0.25, HELLO[1])) : 1);
    const bubbleAt = toWorld(pose, { x: 162, y: 66 });
    s.set("hello", "transform", `translate(${r(bubbleAt.x)} ${r(bubbleAt.y)}) scale(${r(helloK)})`);

    // The paw: reach for the mug, carry it, let go; later, a paw to the mouth, then waving.
    const holding = t >= 1.2 && t < 3.6;
    const waving = t >= HELLO[0] + 0.3 && t < HELLO[1];
    if (holding) pose.paw = pawFromWorld(pose, cradle(mug));
    else if (waving) pose.paw = { x: WAVE_PAW.x + Math.sin((t - HELLO[0]) * 11) * 6, y: WAVE_PAW.y };
    else
      pose.paw = track(t, [
        [0.9, REST_PAW],
        [1.2, pawFromWorld(pose, cradle(mugAt(1.2, pose)))],
        [3.6, pawFromWorld(pose, cradle(mugAt(3.6, pose)))],
        [3.8, REST_PAW],
        [CRACK, REST_PAW],
        [CRACK + 0.12, { x: 104, y: 146 }],
        [CRACK + 0.5, { x: 104, y: 146 }],
        [CRACK + 0.6, REST_PAW],
        [HELLO[0], REST_PAW],
        [HELLO[0] + 0.3, WAVE_PAW],
        [HELLO[1], WAVE_PAW],
        [HELLO[1] + 0.5, REST_PAW],
      ]);

    if (t < SING[0]) lookAt(pose, mug.pos);
    if (t >= 1.8 && t < 3.0) {
      pose.eyes = "closed";
      pose.blush = 1;
      pose.tilt += 3;
      pose.headY += 1;
      pose.tail = Math.sin(t * 1.6) * 10;
    }
    if (t >= 3.6 && t < SING[0]) {
      pose.eyes = "happy";
      pose.mouth = "smile";
      pose.blush = 0.6;
    }
    if (t >= SING[0] && t < SING[1]) {
      pose.eyes = "closed";
      pose.mouth = Math.sin(t * 9) > 0 ? "o" : "w";
      pose.tilt += Math.sin(t * 4) * 6;
      pose.headY += Math.sin(t * 8) * 1.2;
      pose.tail = Math.sin(t * 4) * 16;
      pose.blush = 0.4;
      // A twirl at the far end.
      if (t >= 5.5 && t < 5.7) pose.flip = t < 5.6 ? 1 : -1;
    }
    if (t >= CRACK && t < CRACK + 0.5) {
      pose.eyes = "open";
      pose.eyeScale = 1.3;
      pose.mouth = "o";
      pose.perk = 1;
      pose.blush = 1;
      pose.sweat = 1;
      pose.lookX = 0;
      pose.lookY = 0;
    }
    if (t >= CRACK + 0.5 && t < HELLO[0]) laughing(pose, t);
    if (t >= HELLO[0] && t < HELLO[1]) {
      pose.eyes = t < 10.2 ? "happy" : "wink";
      pose.mouth = "grin";
      pose.blush = 0.8;
      pose.perk = 0.5;
      pose.tail = Math.sin(t * 13) * 15;
      pose.tilt += 3 + Math.sin(t * 5) * 2;
      pose.lookX = 0;
      pose.lookY = 0.8;
      if (t < HELLO[0] + 0.6) pose.y -= Math.abs(Math.sin(((t - HELLO[0]) / 0.3) * Math.PI)) * 5;
    }
    if (t >= HELLO[1]) {
      pose.lookX = 0;
      pose.lookY = 1.2;
      pose.mouth = "smile";
    }
    if (pose.eyes === "open") pose.lid = Math.max(pose.lid, 0.9 * blinks(t, [0.3, 3.85, 11.6]));
    applyPose(s, pose);
  },

  status: (t) => (t < 3.6 ? "A sip of tea first" : t < CRACK ? "Warming up the voice" : t < HELLO[0] ? "Oops, that was a squeak" : "Getting ready to say hello"),
};
