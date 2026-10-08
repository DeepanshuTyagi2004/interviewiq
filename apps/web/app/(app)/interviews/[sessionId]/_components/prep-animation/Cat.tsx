import type { ReactNode } from "react";
import { c, fill, shape, stroke } from "./palette";

/**
 * The InterviewIQ cat (from the "Cat Reader Loader" design): a round clay-orange cat drawn in its own
 * coordinates (sitting on the floor at y≈222, body centred on x≈82). `applyPose` (pose.ts) moves the
 * whole rig (walking, falling over, facing left or right) and every expression part each frame.
 *
 * Layers, back to front: the body (`CatBody`, with anything hugged to its tummy as `children`), the
 * right arm (`CatArm`), what the paw holds (`CatHand`), then the paw (`CatPaw`). All four share the rig
 * transform, so a held tool stays in the paw wherever the cat goes.
 */
export type Accessory = "glasses" | "headset" | "none";

const ear = { strokeWidth: 10, strokeLinejoin: "round" } as const;
const STAR = "M0 -5 L1.4 -1.4 L5 0 L1.4 1.4 L0 5 L-1.4 1.4 L-5 0 L-1.4 -1.4 Z";

export function CatShadow() {
  return <ellipse data-part="catShadow" cx="0" cy="0" rx="46" ry="5" transform="translate(82 223)" style={fill("fur-deep", { fillOpacity: 0.13 })} />;
}

export function CatBody({ accessory, children }: { accessory: Accessory; children?: ReactNode }) {
  return (
    <g data-part="cat">
      <g data-part="tail">
        <path d="M54 204 C 22 206, 8 178, 22 152" style={stroke("fur", 13)} />
        <path d="M19 166 C 18 160, 19 156, 22 152" style={stroke("fur-dark", 13)} />
      </g>
      <g data-part="torso">
        <ellipse cx="82" cy="182" rx="45" ry="36" style={fill("fur")} />
        <ellipse cx="88" cy="190" rx="25" ry="22" style={fill("belly")} />
        <ellipse cx="72" cy="180" rx="10" ry="8" style={shape("fur", "fur-mid", 1.5)} />
      </g>
      <Foot part="footL" cx={62} />
      <Foot part="footR" cx={102} />
      <g data-part="head">
        <g data-part="earL">
          <path d="M48 112 L52 70 L82 96 Z" style={{ fill: c("fur"), stroke: c("fur"), ...ear }} />
          <path d="M56 103 L58 83 L72 96 Z" style={{ fill: c("pink"), stroke: c("pink"), strokeWidth: 4, strokeLinejoin: "round" }} />
        </g>
        <g data-part="earR">
          <path d="M98 96 L126 70 L128 112 Z" style={{ fill: c("fur"), stroke: c("fur"), ...ear }} />
          <path d="M106 96 L121 83 L121 103 Z" style={{ fill: c("pink"), stroke: c("pink"), strokeWidth: 4, strokeLinejoin: "round" }} />
        </g>
        {accessory === "headset" ? <path d="M41 124 C 38 61, 138 61, 135 124" style={stroke("ink", 5)} /> : null}
        <ellipse cx="88" cy="122" rx="49" ry="38" style={fill("fur")} />
        <g style={stroke("fur-dark", 3.5)}>
          <line x1="81" y1="89" x2="81" y2="96" />
          <line x1="89" y1="87" x2="89" y2="95" />
          <line x1="97" y1="89" x2="97" y2="96" />
        </g>
        <ellipse data-part="blushL" cx="61" cy="137" rx="7.5" ry="4.2" opacity="0.8" style={fill("pink")} />
        <ellipse data-part="blushR" cx="117" cy="137" rx="7.5" ry="4.2" opacity="0.8" style={fill("pink")} />
        <Eye part="eyeL" cx={72} />
        <Eye part="eyeR" cx={106} />
        <g data-part="happy" opacity="0" style={stroke("ink", 3.6)}>
          <path d="M64.5 126 Q72 117 79.5 126" />
          <path d="M98.5 126 Q106 117 113.5 126" />
        </g>
        <path data-part="winkR" d="M98.5 126 Q106 117 113.5 126" opacity="0" style={stroke("ink", 3.6)} />
        <g data-part="closed" opacity="0" style={stroke("ink", 3.4)}>
          <path d="M64.5 123 Q72 130 79.5 123" />
          <path d="M98.5 123 Q106 130 113.5 123" />
        </g>
        <g data-part="laugh" opacity="0" style={stroke("ink", 3.4)}>
          <path d="M65 118.5 L77 124 L65 129.5" />
          <path d="M113 118.5 L101 124 L113 129.5" />
        </g>
        <g data-part="dizzy" opacity="0" style={stroke("ink", 2)}>
          <path data-part="dizzyL" d="M71 124 a1 1 0 0 1 2 0 a2 2 0 0 1 -4 0 a3 3 0 0 1 6 0 a4 4 0 0 1 -8 0 a5 5 0 0 1 10 0" />
          <path data-part="dizzyR" d="M105 124 a1 1 0 0 1 2 0 a2 2 0 0 1 -4 0 a3 3 0 0 1 6 0 a4 4 0 0 1 -8 0 a5 5 0 0 1 10 0" />
        </g>
        <path d="M85.5 131.5 L92.5 131.5 L89 135.5 Z" style={shape("fur-deep", "fur-deep", 2)} />
        <ellipse data-part="tongue" cx="89" cy="141.6" rx="2.4" ry="2.9" opacity="0" style={fill("pink")} />
        <path data-part="mouthW" d="M83 138.5 Q86 142.5 89 138.5 Q92 142.5 95 138.5" style={stroke("ink", 2.2)} />
        <ellipse data-part="mouthO" cx="89" cy="141" rx="3" ry="3.6" opacity="0" style={fill("ink")} />
        <g data-part="mouthSmile" opacity="0">
          <path d="M82.5 138 Q89 149 95.5 138 Z" style={shape("ink", "ink", 1.6)} />
          <ellipse cx="89" cy="143.4" rx="3.2" ry="1.9" style={fill("pink")} />
        </g>
        <g data-part="mouthGrin" opacity="0">
          <path d="M79.5 136.8 Q89 149 98.5 136.8 Z" style={shape("ink", "ink", 1.6)} />
          <path d="M81.4 137.4 L96.6 137.4 Q96 139.8 94.8 140.6 L83.2 140.6 Q82 139.8 81.4 137.4 Z" style={fill("shine")} />
          <line x1="89" y1="137.4" x2="89" y2="140.6" style={stroke("ink", 0.8)} />
        </g>
        <g data-part="mouthLaugh" opacity="0">
          <path d="M78.5 136 Q89 157 99.5 136 Z" style={shape("ink", "ink", 1.6)} />
          <ellipse cx="89" cy="148.6" rx="5.6" ry="3.2" style={fill("pink")} />
          <path d="M81.8 136.6 L83.9 141.4 L86 136.6 Z" style={fill("shine")} />
          <path d="M92 136.6 L94.1 141.4 L96.2 136.6 Z" style={fill("shine")} />
        </g>
        <path data-part="mouthFlat" d="M84.5 139.8 Q89 138.6 93.5 139.8" opacity="0" style={stroke("ink", 2.2)} />
        <path data-part="mouthWavy" d="M82 140 q2 -2.4 4 0 t4 0 t4 0 t4 0" opacity="0" style={stroke("ink", 2)} />
        <g style={stroke("ink", 1.6, { strokeOpacity: 0.45 })}>
          <line x1="57" y1="132" x2="38" y2="128" />
          <line x1="57" y1="137" x2="38" y2="139" />
          <line x1="121" y1="132" x2="140" y2="128" />
          <line x1="121" y1="137" x2="140" y2="139" />
        </g>
        {accessory === "glasses" ? <Glasses /> : null}
        {accessory === "headset" ? <Headset /> : null}
        <Bandage />
        <g data-part="sweat" transform="translate(136 98) scale(0)">
          <path d="M0 -7 C 3.4 -2, 4.6 1.2, 0 4.6 C -4.6 1.2, -3.4 -2, 0 -7 Z" style={fill("sky")} />
          <path d="M-1.4 0 Q-1.6 2 0 2.6" style={stroke("shine", 1.2)} />
        </g>
        {[0, 1, 2].map((i) => (
          <g key={i} data-part={`dstar${i}`} transform="scale(0)">
            <path d={STAR} style={shape("gold", "fur-deep", 0.8)} />
          </g>
        ))}
      </g>
      {children}
    </g>
  );
}

function Foot({ part, cx }: { part: string; cx: number }) {
  return (
    <g data-part={part}>
      <ellipse cx={cx} cy="214" rx="13" ry="7.5" style={fill("fur")} />
      <g style={stroke("fur-dark", 1.8)}>
        <line x1={cx - 4} y1="212" x2={cx - 4} y2="217" />
        <line x1={cx + 3} y1="212" x2={cx + 3} y2="217" />
      </g>
    </g>
  );
}

function Eye({ part, cx }: { part: string; cx: number }) {
  return (
    <g data-part={part}>
      <ellipse cx={cx} cy="124" rx="7.5" ry="9.5" style={fill("ink")} />
      <circle cx={cx + 2.6} cy="120.4" r="2.9" style={fill("shine")} />
      <circle cx={cx - 2} cy="128.2" r="1.3" style={fill("shine")} />
    </g>
  );
}

/** The cross plaster a fall earns: scaled in by `pose.bandage` and kept for the rest of the chapter. */
function Bandage() {
  const strip = shape("cream", "paper-edge", 1);
  return (
    <g data-part="bandage" transform="translate(108 99) scale(0)">
      <rect x="-12" y="-4" width="24" height="8" rx="3.6" transform="rotate(-35)" style={strip} />
      <rect x="-12" y="-4" width="24" height="8" rx="3.6" transform="rotate(55)" style={strip} />
      <rect x="-3.4" y="-3.4" width="6.8" height="6.8" rx="1.4" transform="rotate(10)" style={fill("belly")} />
      {[
        [-7.5, 5],
        [7.5, -5],
        [-4, -6.5],
        [4, 6.5],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="0.8" style={fill("rule-strong")} />
      ))}
    </g>
  );
}

function Glasses() {
  return (
    <g style={{ fill: c("shine"), fillOpacity: 0.12, stroke: c("ink"), strokeWidth: 2.4 }}>
      <circle cx="72" cy="124" r="13" />
      <circle cx="106" cy="124" r="13" />
      <path d="M85 122 Q89 118 93 122" style={{ fill: "none" }} />
      <line x1="59" y1="121" x2="46" y2="116" strokeLinecap="round" />
      <line x1="119" y1="121" x2="131" y2="116" strokeLinecap="round" />
    </g>
  );
}

/** The headset's cups and mic; the band goes behind the head (above) so it arcs over the top. */
function Headset() {
  return (
    <g>
      <ellipse cx="41" cy="126" rx="7.5" ry="11.5" style={fill("ink")} />
      <ellipse cx="135" cy="126" rx="7.5" ry="11.5" style={fill("ink")} />
      <ellipse cx="135" cy="126" rx="3.5" ry="6.5" style={fill("fur-deep")} />
      <path d="M43 135 Q 48 153 68 150" style={stroke("ink", 3)} />
      <circle cx="71" cy="150" r="4.2" style={fill("ink")} />
    </g>
  );
}

/** The free (right) arm: a short limb from the shoulder to the paw, rewritten each frame. */
export function CatArm() {
  return (
    <g data-part="armRig">
      <path data-part="arm" d="M116 160 Q130 172 126 192" style={stroke("fur", 12)} />
    </g>
  );
}

/** Whatever the paw holds, in the cat's own coordinates (moves with the rig). */
export function CatHand({ children }: { children?: ReactNode }) {
  return <g data-part="handRig">{children}</g>;
}

export function CatPaw() {
  return (
    <g data-part="pawRig">
      <g data-part="paw" transform="translate(126 192)">
        <circle cx="0" cy="0" r="9" style={fill("fur")} />
        <circle cx="-3.5" cy="-3" r="1.6" style={fill("pink")} />
        <circle cx="0.5" cy="-4.6" r="1.6" style={fill("pink")} />
        <circle cx="4.2" cy="-2.6" r="1.6" style={fill("pink")} />
      </g>
    </g>
  );
}
