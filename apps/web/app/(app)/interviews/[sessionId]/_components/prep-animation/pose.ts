import { back, clamp, eio, eout, r, seg, track, type Point } from "./motion";
import type { Stage } from "./stage";

export type Eyes = "open" | "happy" | "closed" | "laugh" | "dizzy" | "wink";
export type Mouth = "w" | "o" | "smile" | "blep" | "flat" | "grin" | "laugh" | "wavy";

/**
 * Everything the cat can express in one frame. Scenes start from `idlePose(t)`, move it around with the
 * helpers below (`stroll`, `laughing`, `tumbling`) and override what the moment needs; `applyPose`
 * writes it to the Cat parts.
 */
export interface CatPose {
  /** Whole-cat offset: where it is on the floor, and hops. */
  x: number;
  y: number;
  /** Whole-cat rotation in degrees about the middle of the body (falling over). */
  rot: number;
  /** 1 faces right (as drawn), -1 mirrored to face left. */
  flip: 1 | -1;
  /** Landing squash, 0..1: wider and shorter. */
  squash: number;
  /** Walk cycle: the feet step with `step` (radians) by `stepAmp` (0..1). */
  step: number;
  stepAmp: number;
  /** Breathing, -1..1. */
  breathe: number;
  /** Head rotation in degrees (about the neck) and vertical offset. */
  tilt: number;
  headY: number;
  /** Pupil offset in px: where the cat is looking. */
  lookX: number;
  lookY: number;
  eyes: Eyes;
  /** Eye size: 1 normal, ~1.2 wide-eyed. */
  eyeScale: number;
  /** Eyelids: 0 open, ~0.4 a focused squint, 1 shut (a blink). */
  lid: number;
  /** Ears up and forward (alert), out and down (unimpressed), and a right-ear twitch, each 0..1. */
  perk: number;
  droop: number;
  twitch: number;
  mouth: Mouth;
  /** Extra blush, 0..1. */
  blush: number;
  /** Tail angle in degrees. */
  tail: number;
  /** Right paw, in the cat's own coordinates. */
  paw: Point;
  /** The cross bandage on the head (0 none, 1 on), a sweat drop, and dizzy stars (0..1, spun by `spin`). */
  bandage: number;
  sweat: number;
  stars: number;
  spin: number;
}

/** Where the right paw rests when it isn't doing anything. */
export const REST_PAW: Point = { x: 126, y: 192 };
/** Paw on the belly (laughing), on the chin (thinking), at the cheek, and raised to wave. */
export const BELLY_PAW: Point = { x: 108, y: 190 };
export const CHIN_PAW: Point = { x: 108, y: 150 };
export const CHEEK_PAW: Point = { x: 126, y: 140 };
export const WAVE_PAW: Point = { x: 140, y: 132 };
/** The right shoulder, and how far a natural (never stretched) arm reaches from it. */
export const SHOULDER: Point = { x: 116, y: 160 };
export const ARM_REACH = 38;
/** Falls rotate about the middle of the body; squash and the facing flip are about the feet. */
const PIVOT: Point = { x: 82, y: 180 };
const GROUND: Point = { x: 82, y: 222 };

export function idlePose(t: number): CatPose {
  const breathe = Math.sin(t * 3);
  return {
    x: 0,
    y: 0,
    rot: 0,
    flip: 1,
    squash: 0,
    step: 0,
    stepAmp: 0,
    breathe,
    tilt: 0,
    headY: breathe * 0.8,
    lookX: 0,
    lookY: 0,
    eyes: "open",
    eyeScale: 1,
    lid: 0,
    perk: 0,
    droop: 0,
    twitch: 0,
    mouth: "w",
    blush: 0,
    tail: Math.sin(t * 2.4) * 8,
    paw: REST_PAW,
    bandage: 0,
    sweat: 0,
    stars: 0,
    spin: 0,
  };
}

const scaleOf = (p: CatPose) => ({ sx: (1 + 0.14 * p.squash) * p.flip, sy: 1 - 0.16 * p.squash });

/** The whole-cat transform: flip and squash about the feet, rotate about the body, then move. */
export function rigTransform(p: CatPose): string {
  const { sx, sy } = scaleOf(p);
  return `translate(${r(p.x)} ${r(p.y)}) rotate(${r(p.rot)} ${PIVOT.x} ${PIVOT.y}) translate(${GROUND.x} ${GROUND.y}) scale(${r(sx)} ${r(sy)}) translate(${-GROUND.x} ${-GROUND.y})`;
}

/** A point on the cat (its own coordinates) in the scene. */
export function toWorld(p: CatPose, local: Point): Point {
  const { sx, sy } = scaleOf(p);
  const x = GROUND.x + (local.x - GROUND.x) * sx;
  const y = GROUND.y + (local.y - GROUND.y) * sy;
  const a = (p.rot * Math.PI) / 180;
  const dx = x - PIVOT.x;
  const dy = y - PIVOT.y;
  return { x: PIVOT.x + dx * Math.cos(a) - dy * Math.sin(a) + p.x, y: PIVOT.y + dx * Math.sin(a) + dy * Math.cos(a) + p.y };
}

/** A scene point in the cat's own coordinates (e.g. where the paw must go to hold something). */
export function pawFromWorld(p: CatPose, world: Point): Point {
  const { sx, sy } = scaleOf(p);
  const a = (-p.rot * Math.PI) / 180;
  const dx = world.x - p.x - PIVOT.x;
  const dy = world.y - p.y - PIVOT.y;
  const x = PIVOT.x + dx * Math.cos(a) - dy * Math.sin(a);
  const y = PIVOT.y + dx * Math.sin(a) + dy * Math.cos(a);
  return { x: GROUND.x + (x - GROUND.x) / sx, y: GROUND.y + (y - GROUND.y) / sy };
}

/** Turns the pupils towards a point in the scene. */
export function lookAt(pose: CatPose, target: Point): void {
  const local = pawFromWorld(pose, target);
  pose.lookX = clamp((local.x - 88) / 40, -1, 1) * 2.6;
  pose.lookY = clamp((local.y - 124) / 40, -1, 1) * 2.2;
}

/** A walking step on the spot: feet, a bob, a swinging tail. `amount` 0..1. */
export function walking(pose: CatPose, t: number, amount = 1): void {
  pose.step = t * 13;
  pose.stepAmp = amount;
  pose.y -= Math.abs(Math.sin(pose.step)) * 3 * amount;
  pose.tail += Math.sin(pose.step) * 10 * amount;
  pose.tilt += Math.sin(pose.step) * 2 * amount;
}

/**
 * Walks the cat along the floor through keyframes `[time, x]`: it eases between them, steps while it
 * moves, and faces the way it last walked (so it doesn't spin round when it stops).
 */
export function stroll(pose: CatPose, t: number, keys: [number, number][]): void {
  const at = (u: number) => track(u, keys.map(([k, x]) => [k, { x, y: 0 }] as [number, Point])).x;
  const v = (at(t + 0.04) - at(t - 0.04)) / 0.08;
  pose.x = at(t);
  let facing: 1 | -1 = 1;
  for (let i = 0; i < keys.length - 1 && keys[i]![0] <= t; i++) {
    const d = keys[i + 1]![1] - keys[i]![1];
    if (d !== 0) facing = d > 0 ? 1 : -1;
  }
  pose.flip = facing;
  const moving = clamp(Math.abs(v) / 50, 0, 1);
  if (moving > 0.05) walking(pose, t, moving);
}

/** A belly laugh: squeezed eyes, open mouth with fangs, a paw on the tummy, the whole cat shaking. */
export function laughing(pose: CatPose, t: number, amount = 1): void {
  pose.eyes = "laugh";
  pose.mouth = "laugh";
  pose.blush = 1;
  pose.perk = 0.3;
  pose.y -= Math.abs(Math.sin(t * 20)) * 2.5 * amount;
  pose.tilt += Math.sin(t * 10) * 5 * amount;
  pose.tail = Math.sin(t * 16) * 18;
  pose.paw = BELLY_PAW;
}

/** How long a fall takes, from the trip to the sheepish grin. */
export const TUMBLE = 2.8;

/**
 * Trips at `a` and falls over (`dir` 1 forwards to the right, -1 backwards to the left): dizzy on the
 * floor, gets up, shakes it off, and wears a bandage from then on. Returns true while the fall is
 * playing, so the scene leaves the pose alone.
 */
export function tumbling(pose: CatPose, t: number, a: number, dir: 1 | -1): boolean {
  const u = t - a;
  if (u < 0) return false;
  pose.bandage = Math.max(pose.bandage, back(seg(u, 1.95, 2.2)));
  if (u >= TUMBLE) return false;

  let lean = 0;
  if (u < 0.15) lean = 0.14 * eio(u / 0.15);
  else if (u < 0.45) lean = 0.14 + 0.86 * eout(seg(u, 0.15, 0.45));
  else if (u < 1.3) lean = 1;
  else lean = 1 - back(seg(u, 1.3, 1.75));
  pose.rot = dir * 88 * lean;
  pose.y -= 10 * Math.abs(Math.sin((pose.rot * Math.PI) / 180));
  pose.squash = Math.max(pose.squash, u > 0.45 && u < 0.7 ? Math.sin(Math.PI * seg(u, 0.45, 0.7)) * 0.8 : 0);
  pose.paw = REST_PAW;
  pose.lookX = 0;
  pose.lookY = 0;

  if (u < 0.45) {
    pose.eyeScale = 1.3;
    pose.mouth = "o";
    pose.perk = 1;
    pose.sweat = 1;
  } else if (u < 1.3) {
    pose.eyes = "dizzy";
    pose.mouth = "wavy";
    pose.droop = 0.6;
    pose.tail = dir * 30;
    pose.stars = Math.min(1, seg(u, 0.5, 0.65) * 1);
    pose.spin = u * 6;
  } else if (u < 1.75) {
    pose.eyes = "closed";
    pose.mouth = "flat";
    pose.stars = 1 - seg(u, 1.3, 1.5);
    pose.spin = u * 6;
  } else if (u < 2.15) {
    pose.eyes = u < 2.0 ? "closed" : "open";
    pose.mouth = "flat";
    pose.tilt = Math.sin(u * 30) * 9 * (1 - seg(u, 1.75, 2.15));
  } else {
    pose.eyes = "happy";
    pose.mouth = "grin";
    pose.blush = 1;
    pose.sweat = 1 - seg(u, 2.6, 2.8);
    pose.tilt = 4;
    pose.paw = { x: CHEEK_PAW.x + Math.cos(u * 14) * 2.5, y: CHEEK_PAW.y + Math.sin(u * 14) * 2.5 };
  }
  return true;
}

const EYE_PARTS: Record<Eyes, string[]> = {
  open: ["eyeL", "eyeR"],
  happy: ["happy"],
  closed: ["closed"],
  laugh: ["laugh"],
  dizzy: ["dizzy"],
  wink: ["eyeL", "winkR"],
};
const ALL_EYE_PARTS = ["eyeL", "eyeR", "happy", "closed", "laugh", "dizzy", "winkR"];

const MOUTH_PARTS: Record<Mouth, string[]> = {
  w: ["mouthW"],
  o: ["mouthO"],
  smile: ["mouthSmile"],
  blep: ["mouthW", "tongue"],
  flat: ["mouthFlat"],
  grin: ["mouthGrin"],
  laugh: ["mouthLaugh"],
  wavy: ["mouthWavy"],
};
const ALL_MOUTH_PARTS = ["mouthW", "mouthO", "mouthSmile", "mouthFlat", "tongue", "mouthGrin", "mouthLaugh", "mouthWavy"];

export function applyPose(s: Stage, p: CatPose): void {
  const rig = rigTransform(p);
  s.set("cat", "transform", rig);
  s.set("armRig", "transform", rig);
  s.set("pawRig", "transform", rig);
  s.set("handRig", "transform", rig);
  // The floor shadow follows the cat and shrinks as it leaves the ground.
  const lift = clamp(-p.y / 40, 0, 0.5);
  s.set("catShadow", "transform", `translate(${r(p.x + 82)} 223) scale(${r(1 - lift)} 1)`);

  s.set("torso", "transform", `translate(82 216) scale(1 ${r(1 + 0.015 * p.breathe)}) translate(-82 -216)`);
  s.set("tail", "transform", `rotate(${r(p.tail)} 54 204)`);
  const lifted = (phase: number) => p.stepAmp * Math.max(0, Math.sin(phase));
  s.set("footL", "transform", `translate(${r(Math.sin(p.step) * 5 * p.stepAmp)} ${r(-lifted(p.step) * 5)})`);
  s.set("footR", "transform", `translate(${r(Math.sin(p.step + Math.PI) * 5 * p.stepAmp)} ${r(-lifted(p.step + Math.PI) * 5)})`);
  s.set("head", "transform", `translate(0 ${r(p.headY)}) rotate(${r(p.tilt)} 88 150)`);

  const earLift = -3 * p.perk + 3 * p.droop;
  s.set("earL", "transform", `translate(0 ${r(earLift)}) rotate(${r(-6 * p.perk - 18 * p.droop)} 62 104)`);
  s.set("earR", "transform", `translate(0 ${r(earLift)}) rotate(${r(6 * p.perk + 18 * p.droop + 8 * p.twitch)} 116 104)`);

  const sy = p.eyeScale * Math.max(0.08, 1 - p.lid);
  for (const [part, cx] of [
    ["eyeL", 72],
    ["eyeR", 106],
  ] as const) {
    s.set(part, "transform", `translate(${r(cx + p.lookX)} ${r(124 + p.lookY)}) scale(${r(p.eyeScale)} ${r(sy)}) translate(${-cx} -124)`);
  }
  const eyes = EYE_PARTS[p.eyes];
  for (const part of ALL_EYE_PARTS) s.set(part, "opacity", eyes.includes(part) ? 1 : 0);
  s.set("dizzyL", "transform", `rotate(${r(p.spin * 80)} 72 124)`);
  s.set("dizzyR", "transform", `rotate(${r(p.spin * 80)} 106 124)`);

  const mouth = MOUTH_PARTS[p.mouth];
  for (const part of ALL_MOUTH_PARTS) s.set(part, "opacity", mouth.includes(part) ? 1 : 0);

  const blush = 0.75 + 0.25 * clamp(p.blush, 0, 1);
  s.set("blushL", "opacity", blush);
  s.set("blushR", "opacity", blush);

  s.set("bandage", "transform", `translate(108 99) scale(${r(Math.max(0, p.bandage))})`);
  s.set("sweat", "transform", `translate(136 98) scale(${r(clamp(p.sweat, 0, 1))})`);
  for (let i = 0; i < 3; i++) {
    const a = p.spin + (i * Math.PI * 2) / 3;
    const k = clamp(p.stars, 0, 1) * (0.8 + 0.25 * Math.sin(a));
    s.set(`dstar${i}`, "transform", `translate(${r(88 + 36 * Math.cos(a))} ${r(78 + 9 * Math.sin(a))}) scale(${r(k)})`);
  }

  // A natural arm: never longer than its reach, with a soft elbow bend outwards.
  const paw = natural(p.paw);
  const dx = paw.x - SHOULDER.x;
  const dy = paw.y - SHOULDER.y;
  const len = Math.hypot(dx, dy) || 1;
  const out = -dy / len > 0 ? 1 : -1;
  const elbow = { x: SHOULDER.x + dx / 2 + out * (-dy / len) * 6, y: SHOULDER.y + dy / 2 + out * (dx / len) * 6 };
  s.set("arm", "d", `M${SHOULDER.x} ${SHOULDER.y} Q${r(elbow.x)} ${r(elbow.y)} ${r(paw.x)} ${r(paw.y)}`);
  s.set("paw", "transform", `translate(${r(paw.x)} ${r(paw.y)})`);
}

/** Pulls a paw position back within the arm's reach. */
export function natural(paw: Point): Point {
  const dx = paw.x - SHOULDER.x;
  const dy = paw.y - SHOULDER.y;
  const len = Math.hypot(dx, dy);
  if (len <= ARM_REACH) return paw;
  return { x: SHOULDER.x + (dx / len) * ARM_REACH, y: SHOULDER.y + (dy / len) * ARM_REACH };
}
