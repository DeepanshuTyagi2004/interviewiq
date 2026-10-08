import { back, blinks, bump, clamp, eio, eout, lerp, r, seg } from "../motion";
import { c, fill, shape, stroke } from "../palette";
import { applyPose, idlePose, laughing, stroll } from "../pose";
import { AlertBubble, popBubble } from "../props";
import type { Scene } from "./types";

/**
 * Reader (the original "Cat Reader Loader" design): the cat strolls in with its magnifying glass and
 * holds it still while the page slides under it, spots something, swaps to a highlighter, marks the
 * line, has a proper belly laugh about it, scrolls back to the top and winks.
 */
const LINES: [number, number][] = [
  [84, 262],
  [100, 250],
  [116, 258],
];
const TARGET_Y = 132;
const TARGET_X2 = 240;
/** Where the paw holds the glass and the highlighter, in the cat's own coordinates. */
const HAND = { x: 138, y: 150 };
/** The walk in, before the reading starts. */
const ENTER = 1.4;

export const reader: Scene = {
  id: "reader",
  duration: 12,
  still: 8.6,
  accessory: "glasses",

  back: (uid) => (
    <g data-part="page">
      <rect x="151" y="48" width="132" height="168" rx="10" style={fill("paper-back")} />
      <rect x="148" y="44" width="132" height="168" rx="10" style={shape("paper", "paper-edge", 2)} />
      <g id={`${uid}-page`}>
        <rect data-part="hl" x="160" y="124" height="16" width="0" rx="4" style={fill("highlight")} />
        <line x1="166" y1="64" x2="214" y2="64" style={stroke("fur", 7, { strokeOpacity: 0.55 })} />
        {[
          [84, 262],
          [100, 250],
          [116, 258],
          [132, 240],
          [148, 254],
          [164, 232],
          [180, 246],
          [196, 210],
        ].map(([y, x2]) => (
          <line key={y} x1="166" y1={y} x2={x2} y2={y} style={stroke(y === TARGET_Y ? "rule-strong" : "rule", 5)} />
        ))}
      </g>
      <g data-part="spark0" transform="scale(0)">
        <path d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z" style={fill("fur")} />
      </g>
      <g data-part="spark1" transform="scale(0)">
        <path d="M0 -4.5 L1.2 -1.2 L4.5 0 L1.2 1.2 L0 4.5 L-1.2 1.2 L-4.5 0 L-1.2 -1.2 Z" style={fill("gold")} />
      </g>
      <g data-part="spark2" transform="scale(0)">
        <path d="M0 -5 L1.4 -1.4 L5 0 L1.4 1.4 L0 5 L-1.4 1.4 L-5 0 L-1.4 -1.4 Z" style={fill("fur")} />
      </g>
    </g>
  ),

  inHand: (uid) => (
    <>
      <defs>
        <clipPath id={`${uid}-lens`}>
          <circle cx="198" cy="112" r="17" />
        </clipPath>
      </defs>
      <g data-part="mag">
        <line x1="182.8" y1="121.6" x2="138" y2="150" style={stroke("ink", 5.5)} />
        <line x1="158.2" y1="137.2" x2="138" y2="150" style={stroke("fur-deep", 8.5)} />
        <g clipPath={`url(#${uid}-lens)`}>
          <circle cx="198" cy="112" r="17" style={fill("paper")} />
          <use data-part="lensUse" href={`#${uid}-page`} />
          <circle cx="198" cy="112" r="17" style={fill("sky", { fillOpacity: 0.22 })} />
          <path d="M188 106 A 11 11 0 0 1 195 100.5" style={stroke("shine", 3, { strokeOpacity: 0.9 })} />
        </g>
        <circle cx="198" cy="112" r="18" style={stroke("ink", 4.5)} />
      </g>
      <g data-part="marker" transform="scale(0)">
        <g transform="translate(186 124) rotate(151.6)">
          <path d="M0 0 L9 -5 L9 5 Z" style={shape("gold", "ink", 1.4)} />
          <rect x="9" y="-6" width="6" height="12" rx="1.5" style={fill("ink")} />
          <rect x="14" y="-7.5" width="42" height="15" rx="5" style={shape("cream", "ink", 2)} />
          <rect x="38" y="-6.5" width="6" height="13" style={{ fill: c("highlight") }} />
        </g>
      </g>
    </>
  ),

  over: () => <AlertBubble />,

  frame(t, s) {
    const u = Math.max(0, t - ENTER);
    // The page slides under a tool the cat holds still.
    let lineY = 84;
    let x2 = 262;
    let prog = 0;
    let hlW = 0;
    let hlOp = 1;
    if (u >= 0.3 && u < 4.5) {
      const k = Math.min(2, Math.floor((u - 0.3) / 1.4));
      const v = u - (0.3 + k * 1.4);
      const [ly, lx2] = LINES[k]!;
      const [ny, nx2] = k < 2 ? LINES[k + 1]! : [TARGET_Y, TARGET_X2];
      if (v < 1.1) {
        lineY = ly;
        x2 = lx2;
        prog = eio(v / 1.1);
      } else {
        const p = eio((v - 1.1) / 0.3);
        lineY = lerp(ly, ny, p);
        x2 = lerp(lx2, nx2, p);
        prog = 1 - p;
      }
    } else if (u >= 4.5) {
      lineY = TARGET_Y;
      x2 = TARGET_X2;
      if (u < 5.2) prog = eout((u - 4.5) / 0.7) * 0.3;
      else if (u < 6.0) prog = 0.3;
      else if (u < 6.4) prog = 0.3 * (1 - eio((u - 6.0) / 0.4));
      else if (u < 7.8) {
        prog = (u - 6.4) / 1.4;
        hlW = prog * 84;
      } else if (u < 9.0) {
        prog = 1;
        hlW = 84;
      } else {
        const p = eio(seg(u, 9.0, 9.7));
        lineY = lerp(TARGET_Y, 84, p);
        x2 = lerp(TARGET_X2, 262, p);
        prog = 1 - p;
        hlW = 84;
        hlOp = 1 - seg(u, 9.0, 9.4);
      }
    }

    const pose = idlePose(t);
    stroll(pose, t, [
      [0, -120],
      [ENTER, 0],
    ]);
    const found = bump(u, 5.2, 0.15, 0.55, 0.25);
    const laughs = u >= 7.8 && u < 9.0;
    pose.x += found * 3;
    if (found > 0) pose.y -= Math.sin(Math.PI * seg(u, 5.2, 5.5)) * 6;
    if (laughs) laughing(pose, t);
    pose.paw = { x: HAND.x, y: HAND.y + Math.sin(t * 3) * 0.6 };

    // The page is in scene coordinates; the lens, in the paw, shows the bit under it (magnified).
    const w = u < 6.0 ? 0 : u < 6.4 ? eio(seg(u, 6.0, 6.4)) : u < 9.3 ? 1 : u < 9.7 ? 1 - eio(seg(u, 9.3, 9.7)) : 0;
    const readX = lerp(198, 186, w);
    const readY = lerp(112, 124, w);
    const dx = readX - (166 + prog * (x2 - 166));
    const dy = readY - lineY;
    s.set("page", "transform", `translate(${r(dx)} ${r(dy)})`);
    s.set("hl", "width", hlW);
    s.set("hl", "opacity", hlOp);
    s.set("lensUse", "transform", `translate(198 112) scale(1.7) translate(${r(dx - 198 - pose.x)} ${r(dy - 112 - pose.y)})`);

    const lensK = u < 6.0 ? 1 + 0.08 * bump(u, 5.2, 0.15, 0.35, 0.2) : u < 6.2 ? 1 - eio(seg(u, 6.0, 6.2)) : u < 9.45 ? 0 : back(seg(u, 9.45, 9.75));
    const markK = u < 6.15 ? 0 : u < 6.4 ? back(seg(u, 6.15, 6.4)) : u < 9.3 ? 1 : u < 9.5 ? 1 - eio(seg(u, 9.3, 9.5)) : 0;
    const held = (k: number) => `translate(${HAND.x} ${HAND.y}) scale(${r(Math.max(0, k))}) translate(${-HAND.x} ${-HAND.y})`;
    s.set("mag", "transform", held(lensK));
    s.set("marker", "transform", held(markK));

    if (!laughs) {
      const reading = t >= ENTER && (u < 5.2 || (u > 6.4 && u < 7.8));
      pose.lookX = t < ENTER ? 2.6 : 2.4 + (reading ? Math.sin(t * 7) * 0.5 : 0);
      pose.lookY = t < ENTER ? 0 : clamp((readY - 118) / 30, -1, 1) * 2;
      pose.tilt += pose.lookX * 1.2 - found * 4;
      pose.perk = found;
      pose.twitch = bump(u, 2.55, 0.05, 0.05, 0.1);
      pose.eyeScale = 1 + 0.25 * found;
      pose.mouth = found > 0.3 ? "o" : u > 6.4 && u < 7.8 ? "blep" : "w";
      if (u >= 9.7) {
        pose.eyes = "wink";
        pose.mouth = "grin";
        pose.blush = 1;
        pose.lookX = 0;
        pose.lookY = 0.8;
        pose.tilt = 5 * eout(seg(u, 9.7, 10));
        pose.y -= Math.sin(Math.PI * seg(u, 9.7, 10.1)) * 5;
      }
      if (pose.eyes === "open") pose.lid = 0.9 * blinks(t, [3.2, 5.0]);
    }
    applyPose(s, pose);

    popBubble(s, "bubble", u, 5.2, 6.0, { x: 142 + pose.x, y: 50 });
    [
      [252, 120],
      [234, 110],
      [258, 142],
    ].forEach(([x, y], i) => {
      const a = 7.85 + i * 0.12;
      const p = seg(u, a, a + 0.6);
      s.set(`spark${i}`, "transform", `translate(${x} ${y}) rotate(${r(p * 90)}) scale(${r(Math.sin(Math.PI * p))})`);
    });
  },

  status: (t) => {
    const u = t - ENTER;
    return t < ENTER ? "Off to read your resume" : u < 5.25 ? "Reading your resume" : u < 6.4 ? "Found something interesting" : u < 9.0 ? "Highlighting the good bit" : "Back to the top";
  },
};
