import { back, blinks, bump, eio, eout, lerp, quad, r, seg, track, type Point } from "../motion";
import { fill, shape, stroke, type Tone } from "../palette";
import { applyPose, idlePose, laughing, lookAt, pawFromWorld, REST_PAW, stroll, toWorld, walking } from "../pose";
import { AlertBubble, popBubble, Sparkle, twinkle } from "../props";
import type { Scene } from "./types";

/**
 * Architect (laying out the round): blocks of different sizes drop onto a table, one per part of the
 * interview. One lands crooked, so the cat walks over and nudges the table leg until it settles; the
 * next block bonks it on the head on the way down (dizzy stars, a bandage, and it laughs it off). The
 * alarm clock dings when everything fits, a flag goes up, and the cat does a proud little dance.
 */
const RAIL_Y = 180;
const BLOCK_H = 34;
const FALL = 0.55;
const BLOCKS: { part: string; x: number; w: number; tone: Tone; drop: number; edge?: boolean }[] = [
  { part: "blk0", x: 151, w: 26, tone: "sky", drop: 0.6 },
  { part: "blk1", x: 180, w: 44, tone: "fur", drop: 1.5 },
  { part: "blk2", x: 227, w: 32, tone: "highlight", drop: 4.2 },
  { part: "blk3", x: 262, w: 22, tone: "belly", drop: 7.2, edge: true },
];
const CLOCK: Point = { x: 250, y: 82 };
const NUDGE: [number, number] = [3.3, 3.95];
const LEG: Point = { x: 154, y: 190 };
const BONK = 4.65;
const DING = 8.2;
const FLAG = 8.45;
const WINK = 10.4;
const WALK: [number, number][] = [
  [2.5, 0],
  [3.2, 20],
  [6.6, 20],
  [7.2, -10],
];

/** How far above its resting place a block is (0 once it has landed). */
const fallOffset = (t: number, drop: number) => (t >= drop + FALL ? 0 : -(1 - Math.pow(seg(t, drop, drop + FALL), 2)) * 170);

/** A landing squash: wide and short, then settled. */
function squash(t: number, at: number): number {
  const q = seg(t, at, at + 0.32);
  return q <= 0 || q >= 1 ? 0 : Math.sin(Math.PI * q) * (1 - q);
}

function Block({ part, w, tone, edge }: { part: string; w: number; tone: Tone; edge?: boolean }) {
  return (
    <g data-part={part}>
      <rect x={-w / 2} y={-BLOCK_H} width={w} height={BLOCK_H} rx="5" style={edge ? shape(tone, "rule-strong", 1.6) : fill(tone)} />
      <rect x={-w / 2} y={-8} width={w} height="8" rx="3" style={fill("fur-deep", { fillOpacity: 0.12 })} />
      <line x1={-w / 2 + 5} y1={-BLOCK_H + 6} x2={w / 2 - 5} y2={-BLOCK_H + 6} style={stroke("shine", 2.4, { strokeOpacity: 0.55 })} />
    </g>
  );
}

export const architect: Scene = {
  id: "architect",
  duration: 12,
  still: 5.3,
  accessory: "none",

  back: () => (
    <g>
      <g data-part="clock">
        <circle cx={CLOCK.x - 14} cy={CLOCK.y - 17} r="6" style={fill("fur")} />
        <circle cx={CLOCK.x + 14} cy={CLOCK.y - 17} r="6" style={fill("fur")} />
        <line x1={CLOCK.x - 11} y1={CLOCK.y + 18} x2={CLOCK.x - 15} y2={CLOCK.y + 24} style={stroke("fur-deep", 3)} />
        <line x1={CLOCK.x + 11} y1={CLOCK.y + 18} x2={CLOCK.x + 15} y2={CLOCK.y + 24} style={stroke("fur-deep", 3)} />
        <circle cx={CLOCK.x} cy={CLOCK.y} r="20" style={shape("paper", "fur-deep", 3.5)} />
        {[0, 90, 180, 270].map((a) => (
          <line
            key={a}
            x1={CLOCK.x}
            y1={CLOCK.y - 15}
            x2={CLOCK.x}
            y2={CLOCK.y - 12}
            transform={`rotate(${a} ${CLOCK.x} ${CLOCK.y})`}
            style={stroke("rule-strong", 2)}
          />
        ))}
        <line data-part="hand" x1={CLOCK.x} y1={CLOCK.y} x2={CLOCK.x} y2={CLOCK.y - 13} style={stroke("ink", 2.6)} />
        <circle cx={CLOCK.x} cy={CLOCK.y} r="2.4" style={fill("fur")} />
      </g>
      <g data-part="table">
        <rect x="156" y="186" width="5" height="38" rx="2" style={fill("rule-strong")} />
        <rect x="273" y="186" width="5" height="38" rx="2" style={fill("rule-strong")} />
        <rect x="146" y={RAIL_Y} width="140" height="8" rx="4" style={fill("rule-strong")} />
        {BLOCKS.filter((b) => b.part !== "blk2").map((b) => (
          <Block key={b.part} {...b} />
        ))}
        <g data-part="flag" transform="scale(0)">
          <line x1="0" y1="0" x2="0" y2="-28" style={stroke("ink", 2)} />
          <path d="M0 -28 L17 -23 L0 -17 Z" style={fill("fur")} />
        </g>
      </g>
    </g>
  ),

  // The block that bonks the cat flies in front of it.
  front: () => <Block {...BLOCKS[2]!} />,

  over: () => (
    <>
      <AlertBubble />
      <Sparkle part="spark0" tone="gold" />
      <Sparkle part="spark1" size={0.8} />
      <Sparkle part="spark2" tone="gold" size={0.7} />
    </>
  ),

  frame(t, s) {
    const pose = idlePose(t);
    stroll(pose, t, WALK);

    // The table jiggles under the nudges; the crooked block settles on the second one.
    const nudges = bump(t, NUDGE[0] + 0.15, 0.08, 0.05, 0.12) + bump(t, NUDGE[0] + 0.4, 0.08, 0.05, 0.12);
    s.set("table", "transform", `rotate(${r(Math.sin(t * 50) * 1.6 * nudges)} 216 222)`);
    const settle = eio(seg(t, NUDGE[0] + 0.4, NUDGE[0] + 0.6));

    BLOCKS.forEach((b, i) => {
      const cx = b.x + b.w / 2;
      const land = b.drop + FALL;
      if (i === 2) {
        // Falls onto the cat's head, bounces off and lands in its slot with a spin.
        const head = toWorld(pose, { x: 88, y: 84 });
        let at: Point;
        let spin = 0;
        if (t < BONK) at = { x: head.x, y: lerp(-60, head.y, Math.pow(seg(t, b.drop, BONK), 2)) };
        else {
          const p = eout(seg(t, BONK, BONK + 0.55));
          at = quad(head, { x: 190, y: 0 }, { x: cx, y: RAIL_Y }, p);
          spin = p * 360;
        }
        const k = squash(t, BONK + 0.55);
        s.set(b.part, "transform", `translate(${r(at.x)} ${r(at.y)}) rotate(${r(spin)} 0 ${-BLOCK_H / 2}) scale(${r(1 + 0.18 * k)} ${r(1 - 0.2 * k)})`);
        return;
      }
      const k = squash(t, land) + (i === 1 ? squash(t, NUDGE[0] + 0.6) * 0.8 : 0);
      const wobble = t >= land ? Math.sin(seg(t, land, land + 0.5) * Math.PI * 3) * (1 - seg(t, land, land + 0.5)) * 3 : 0;
      const tilt = i === 1 ? -10 * (1 - settle) + wobble : 0;
      s.set(b.part, "transform", `translate(${r(cx)} ${r(RAIL_Y + fallOffset(t, b.drop))}) rotate(${r(tilt)} ${r(-b.w / 2)} 0) scale(${r(1 + 0.18 * k)} ${r(1 - 0.2 * k)})`);
    });

    const spin = t < 7.8 ? t * 300 : lerp(7.8 * 300, Math.ceil((7.8 * 300) / 360) * 360, eout(seg(t, 7.8, DING)));
    s.set("hand", "transform", `rotate(${r(spin)} ${CLOCK.x} ${CLOCK.y})`);
    const ring = bump(t, DING, 0.06, 0.2, 0.2);
    s.set("clock", "transform", `rotate(${r(ring * Math.sin(t * 60) * 6)} ${CLOCK.x} ${CLOCK.y}) translate(0 ${r(-ring * 2)})`);
    const last = BLOCKS[3]!;
    const flagK = t < FLAG ? 0 : back(seg(t, FLAG, FLAG + 0.3));
    s.set("flag", "transform", `translate(${last.x + last.w / 2} ${RAIL_Y - BLOCK_H}) scale(${r(flagK)}) skewY(${r(Math.sin(t * 6) * 4)})`);

    // Where the cat looks: whatever is falling, the table it nudges, the clock, then the flag.
    const falling = BLOCKS.find((b) => t >= b.drop - 0.15 && t < (b.part === "blk2" ? BONK + 0.6 : b.drop + FALL + 0.2));
    if (falling) lookAt(pose, falling.part === "blk2" && t < BONK ? { x: pose.x + 108, y: 20 } : { x: falling.x + falling.w / 2, y: RAIL_Y - 20 + fallOffset(t, falling.drop) });
    else if (t >= NUDGE[0] && t < NUDGE[1]) lookAt(pose, { x: 202, y: 160 });
    else if (t < FLAG) lookAt(pose, CLOCK);
    else lookAt(pose, { x: 273, y: 140 });
    pose.perk = Math.max(...BLOCKS.map((b) => bump(t, b.drop + FALL, 0.05, 0.1, 0.2))) * 0.8;

    // Uh-oh, crooked.
    const uhoh = bump(t, 2.1, 0.1, 0.3, 0.1);
    if (uhoh > 0) {
      pose.eyeScale = 1 + 0.2 * uhoh;
      pose.mouth = "o";
    }
    // The nudge: two little shoves at the table leg, tongue out.
    if (t >= NUDGE[0] && t < NUDGE[1]) {
      pose.lid = 0.35;
      pose.mouth = "blep";
      const leg = pawFromWorld(pose, LEG);
      const pulled = { x: leg.x - 8, y: leg.y };
      pose.paw = track(t, [
        [NUDGE[0], REST_PAW],
        [NUDGE[0] + 0.15, leg],
        [NUDGE[0] + 0.28, pulled],
        [NUDGE[0] + 0.4, leg],
        [NUDGE[0] + 0.52, pulled],
        [NUDGE[1], REST_PAW],
      ]);
    }
    // Looking up just before the bonk; the bonk; dizzy; a bandage; laughing it off.
    if (t >= BONK - 0.25 && t < BONK) {
      pose.eyeScale = 1.3;
      pose.mouth = "o";
      pose.perk = 1;
      pose.sweat = 1;
    }
    if (t >= BONK && t < BONK + 1.0) {
      pose.squash = Math.max(0, 0.8 * (1 - seg(t, BONK, BONK + 0.35)));
      pose.headY += 4 * (1 - seg(t, BONK, BONK + 0.4));
      pose.eyes = "dizzy";
      pose.mouth = "wavy";
      pose.droop = 0.6;
      pose.stars = 1 - seg(t, BONK + 0.8, BONK + 1.0);
      pose.spin = t * 6;
      pose.tilt = Math.sin(t * 6) * 8;
    }
    pose.bandage = back(seg(t, BONK + 0.95, BONK + 1.2));
    if (t >= BONK + 1.05 && t < 6.6) laughing(pose, t);

    // The proud finish: a little dance with a twirl, then a wink.
    if (t >= FLAG && t < WINK) {
      pose.eyes = "closed";
      pose.mouth = "smile";
      pose.blush = 1;
      walking(pose, t, 0.7);
      pose.tail = Math.sin(t * 12) * 16;
      if (t >= 9.2 && t < 9.6) pose.flip = -1;
      if (t < FLAG + 0.5) pose.y -= Math.sin(Math.PI * seg(t, FLAG, FLAG + 0.5)) * 6;
    }
    if (t >= WINK) {
      pose.eyes = "wink";
      pose.mouth = "grin";
      pose.blush = 1;
      pose.lookX = 0;
      pose.lookY = 0.8;
      pose.tilt += 4;
    }
    if (pose.eyes === "open") pose.lid = Math.max(pose.lid, 0.9 * blinks(t, [1.2, 6.9, 7.9]));
    applyPose(s, pose);

    popBubble(s, "bubble", t, 2.1, 2.6, toWorld(pose, { x: 146, y: 54 }));
    twinkle(s, ["spark0", "spark1", "spark2"], [
      [292, 126],
      [256, 118],
      [290, 154],
    ], t, FLAG + 0.1);
  },

  status: (t) =>
    t < 2.1
      ? "Laying out the round"
      : t < NUDGE[1]
        ? "Nudging a piece into place"
        : t < BONK
          ? "Timing each part"
          : t < 6.6
            ? "Ouch!"
            : t < FLAG
              ? "Timing each part"
              : "Everything fits",
};
