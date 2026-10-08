import { back, blinks, bump, eio, eout, lerp, mix, quad, r, seg, track, type Point } from "../motion";
import { fill, shape, stroke } from "../palette";
import { applyPose, idlePose, laughing, lookAt, pawFromWorld, REST_PAW, stroll, toWorld, tumbling } from "../pose";
import { AlertBubble, popBubble, Sparkle, twinkle } from "../props";
import type { Scene } from "./types";

/**
 * Card sorter (picking questions): the cat walks up to the deck and flips cards. The first gets a
 * shrug and the second a firm head shake, both flicked over its shoulder. Stepping back to think, it
 * slips on one and goes down, gets up with a bandage and a sheepish grin, goes back, finds the one,
 * sends it up to the "picked" spot and laughs. The cards carry no text.
 */
const DECK: Point = { x: 252, y: 190 };
/** Where the cat stands to reach the deck. */
const STAND = 91;
/** A held card's centre, and the paw's grip on it, in the cat's own coordinates. */
const HOLD: Point = { x: 158, y: 118 };
const HOLD_GRIP: Point = { x: 138, y: 140 };
/** The paw takes a card off the deck by its top-left corner. */
const DECK_GRIP: Point = { x: -18, y: -20 };
const FLOOR = [
  { x: 34, y: 226, rot: -80 },
  { x: 70, y: 228, rot: 86 },
];
const KICKED = { x: 6, y: 230, rot: 128 };
const PICK = { x: 298, y: 74, rot: 6, scale: 0.8 };
const CARDS = [
  { part: "cardA", T: 1.1, stack: 0 },
  { part: "cardB", T: 3.35, stack: 1.2 },
  { part: "cardC", T: 9.9, stack: 2.4 },
] as const;
const SLIP = 6.25;
const KEEP = 11.0;
const WALK: [number, number][] = [
  [0, 0],
  [1.1, STAND],
  [5.6, STAND],
  [6.4, 40],
  [SLIP + 2.8, 40],
  [9.85, STAND],
];

const deckSpot = (stack: number): Point => ({ x: DECK.x + stack, y: DECK.y + stack * 0.9 });

interface CardState {
  pos: Point;
  rot: number;
  sx: number;
  front: boolean;
  scale: number;
}

/** A card from the deck into the paw (held beside the cat's face), flipped face up. */
function drawn(t: number, T: number, stack: number, hold: Point): CardState {
  const from = deckSpot(stack);
  if (t < T + 0.25) return { pos: from, rot: 0, sx: 1, front: false, scale: 1 };
  if (t < T + 0.55) {
    const p = eio(seg(t, T + 0.25, T + 0.55));
    return { pos: { x: lerp(from.x, hold.x, p), y: lerp(from.y, hold.y, p) - Math.sin(p * Math.PI) * 10 }, rot: lerp(0, -6, p), sx: 1, front: false, scale: 1 };
  }
  const p = seg(t, T + 0.55, T + 0.8);
  return { pos: hold, rot: -6, sx: Math.max(0.04, Math.abs(Math.cos(Math.PI * p))), front: p >= 0.5, scale: 1 };
}

function cardAt(t: number, i: number, hold: Point): CardState {
  const { T, stack } = CARDS[i]!;
  if (i < 2) {
    const tossAt = T + 1.55;
    if (t < tossAt) return drawn(t, T, stack, hold);
    const floor = FLOOR[i]!;
    const p = eio(seg(t, tossAt, tossAt + 0.5));
    // Flicked over the shoulder, spinning once.
    const flying = { pos: quad(hold, { x: (hold.x + floor.x) / 2, y: 6 }, floor, p), rot: lerp(-6, floor.rot - 360, p), sx: 1, front: true, scale: 1 };
    if (i === 1 && t >= SLIP) {
      const k = eout(seg(t, SLIP, SLIP + 0.35));
      return { ...flying, pos: mix(floor, KICKED, k), rot: lerp(floor.rot, KICKED.rot, k) };
    }
    return flying;
  }
  if (t < KEEP) return drawn(t, T, stack, hold);
  const p = eio(seg(t, KEEP, KEEP + 0.5));
  return { pos: quad(hold, { x: hold.x + 20, y: PICK.y - 40 }, PICK, p), rot: lerp(-6, PICK.rot, p), sx: 1, front: true, scale: lerp(1, PICK.scale, p) };
}

/** The paw, in the cat's own coordinates. */
function pawAt(t: number, local: (p: Point) => Point): Point {
  for (let i = 0; i < CARDS.length; i++) {
    const { T, stack } = CARDS[i]!;
    const end = i < 2 ? T + 2.25 : KEEP + 0.45;
    if (t < T || t > end) continue;
    const deckGrip = local({ x: deckSpot(stack).x + DECK_GRIP.x, y: deckSpot(stack).y + DECK_GRIP.y });
    const release = i < 2 ? T + 1.55 : KEEP;
    if (t < T + 0.25) return mix(REST_PAW, deckGrip, eio(seg(t, T, T + 0.25)));
    if (t < T + 0.55) return mix(deckGrip, HOLD_GRIP, eio(seg(t, T + 0.25, T + 0.55)));
    if (t < release) return HOLD_GRIP;
    return track(t, [
      [release, HOLD_GRIP],
      [release + 0.2, { x: 128, y: 126 }],
      [end, REST_PAW],
    ]);
  }
  return REST_PAW;
}

/** A card's back: clay with a paw print. */
function CardBack() {
  return (
    <>
      <rect x="-24" y="-33" width="48" height="66" rx="6" style={shape("fur-dark", "fur-deep", 1.5)} />
      <rect x="-18.5" y="-27.5" width="37" height="55" rx="4" style={stroke("fur", 1.6)} />
      <circle cx="0" cy="5" r="6.5" style={fill("belly")} />
      {[
        [-7, -3.5],
        [-2.4, -7.5],
        [2.4, -7.5],
        [7, -3.5],
      ].map(([x, y]) => (
        <circle key={`${x}`} cx={x} cy={y} r="2.3" style={fill("belly")} />
      ))}
    </>
  );
}

function Card({ part, keeper }: { part: string; keeper?: boolean }) {
  return (
    <g data-part={part}>
      <g data-part={`${part}-flip`}>
        <g data-part={`${part}-back`}>
          <CardBack />
        </g>
        <g data-part={`${part}-front`} opacity="0">
          <rect x="-24" y="-33" width="48" height="66" rx="6" style={shape("paper", "paper-edge", 1.5)} />
          <rect x="-16" y="-25" width="18" height="6" rx="3" style={fill("fur", { fillOpacity: 0.7 })} />
          {[
            [-11, 14],
            [-2, 8],
            [7, 12],
            [16, 2],
          ].map(([y, x2]) => (
            <line key={y} x1="-16" y1={y} x2={x2} y2={y} style={stroke("rule", 3.5)} />
          ))}
          {keeper ? (
            <g data-part="star" transform="translate(13 -22) scale(0)">
              <path d="M0 -8 L2.4 -2.6 L8 -2.4 L3.6 1.4 L5 7.2 L0 4 L-5 7.2 L-3.6 1.4 L-8 -2.4 L-2.4 -2.6 Z" style={shape("gold", "fur-deep", 1)} />
            </g>
          ) : null}
        </g>
      </g>
    </g>
  );
}

export const cardSorter: Scene = {
  id: "card-sorter",
  duration: 13,
  still: 7.0,
  accessory: "none",

  back: () => (
    <>
      {[5.4, 3.9].map((d) => (
        <g key={d} transform={`translate(${DECK.x + d} ${DECK.y + d * 0.9})`}>
          <CardBack />
        </g>
      ))}
    </>
  ),

  // Over the arm, under the paw. Order matters: the first card drawn is the top of the deck.
  front: () => (
    <>
      <Card part="cardC" keeper />
      <Card part="cardB" />
      <Card part="cardA" />
    </>
  ),

  over: () => (
    <>
      <AlertBubble />
      <Sparkle part="spark0" tone="gold" />
      <Sparkle part="spark1" size={0.75} />
      <Sparkle part="spark2" tone="gold" size={0.85} />
    </>
  ),

  frame(t, s) {
    const pose = idlePose(t);
    stroll(pose, t, WALK);
    const hold = toWorld(pose, HOLD);
    const cards = CARDS.map((_, i) => cardAt(t, i, hold));
    cards.forEach((card, i) => {
      const { part } = CARDS[i]!;
      s.set(part, "transform", `translate(${r(card.pos.x)} ${r(card.pos.y)}) rotate(${r(card.rot)}) scale(${r(card.scale)})`);
      s.set(`${part}-flip`, "transform", `scale(${r(card.sx)} 1)`);
      s.set(`${part}-front`, "opacity", card.front ? 1 : 0);
      s.set(`${part}-back`, "opacity", card.front ? 0 : 1);
    });
    s.set("star", "transform", `translate(13 -22) scale(${r(t < KEEP + 0.5 ? 0 : back(seg(t, KEEP + 0.5, KEEP + 0.75)))})`);

    const active = CARDS.findIndex(({ T }, i) => t >= T && t < (i < 2 ? T + 2.05 : KEEP + 0.5));
    lookAt(pose, active >= 0 ? cards[active]!.pos : t < SLIP ? DECK : { x: PICK.x, y: PICK.y });
    pose.paw = pawAt(t, (p) => pawFromWorld(pose, p));

    // Card A: a curious tilt, then a shrug.
    const [a, b] = [CARDS[0]!.T, CARDS[1]!.T];
    if (t >= a + 0.8 && t < a + 1.55) {
      pose.tilt += 6 * eio(seg(t, a + 0.8, a + 1.0));
      if (t >= a + 1.2) {
        pose.mouth = "flat";
        pose.droop = 0.7 * eio(seg(t, a + 1.2, a + 1.35));
        pose.lid = 0.3;
        pose.y -= Math.sin(Math.PI * seg(t, a + 1.2, a + 1.45)) * 3;
      }
    }
    // Card B: a focused squint, then a firm "no".
    if (t >= b + 0.8 && t < b + 1.55) {
      pose.lid = 0.45;
      pose.tilt -= 5 * eio(seg(t, b + 0.8, b + 1.0));
      if (t >= b + 1.2) {
        pose.eyes = "closed";
        pose.mouth = "flat";
        pose.tilt = Math.sin((t - b - 1.2) * 26) * 7;
      }
    }
    // Stepping back to think, it slips on a card it threw.
    if (t >= 5.6 && t < SLIP) {
      pose.lookX = -1.5;
      pose.lookY = -1.5;
      pose.mouth = "w";
    }
    if (!tumbling(pose, t, SLIP, 1)) {
      // Card C: a gasp, it's sent up to the picked spot, then a belly laugh and a wink.
      const gasp = bump(t, KEEP - 0.3, 0.08, 0.2, 0.1);
      if (gasp > 0) {
        pose.eyeScale = 1 + 0.28 * gasp;
        pose.perk = gasp;
        pose.mouth = "o";
      }
      if (t >= KEEP + 0.5 && t < 12.3) laughing(pose, t);
      if (t >= 12.3) {
        pose.eyes = "wink";
        pose.mouth = "grin";
        pose.blush = 1;
        pose.lookX = 0;
        pose.lookY = 0.8;
        pose.y -= Math.sin(Math.PI * seg(t, 12.3, 12.65)) * 5;
      }
      if (pose.eyes === "open") pose.lid = Math.max(pose.lid, 0.9 * blinks(t, [0.6, 3.0, 9.4]));
    }
    applyPose(s, pose);

    popBubble(s, "bubble", t, KEEP - 0.3, KEEP + 0.4, toWorld(pose, { x: 146, y: 54 }));
    twinkle(s, ["spark0", "spark1", "spark2"], [
      [274, 50],
      [322, 92],
      [276, 106],
    ], t, KEEP + 0.45);
  },

  status: (t) =>
    t < 1.1
      ? "Heading to the question deck"
      : t < 2.3
        ? "Drawing a card"
        : t < 3.35
          ? "Hmm, not this one"
          : t < 4.55
            ? "Drawing another"
            : t < 5.6
              ? "Nope"
              : t < SLIP
                ? "Stepping back to think"
                : t < SLIP + 2.8
                  ? "Oops"
                  : t < KEEP - 0.3
                    ? "Back to the deck"
                    : t < KEEP + 0.6
                      ? "This one fits"
                      : "Saving it for your round",
};
