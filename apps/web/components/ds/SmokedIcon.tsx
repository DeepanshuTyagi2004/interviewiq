import * as React from "react";

export type SmokedIconName =
  | "student"
  | "campus"
  | "professional"
  | "hiring"
  | "bootcamp"
  | "schedule"
  | "find"
  | "track"
  | "sources"
  | "practice"
  | "share"
  | "resume"
  | "github"
  | "portfolio"
  | "layers"
  | "chart"
  | "trophy"
  | "assessment"
  | "design"
  | "reviews"
  | "video";

type Kind = "main" | "dim" | "glass" | "solid" | "solidDim";
interface Shape {
  d: string;
  kind: Kind;
  dash?: string;
  transform?: string;
}

/** A circle as a path, so every shape goes through one renderer. */
const c = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/**
 * Bespoke symbols for InterviewIQ, drawn on a 120 grid. Each tells one product idea in two or three
 * parts: a main luminous line, a dimmer supporting layer and a glass panel or filled node.
 */
const ICONS: Record<SmokedIconName, Shape[]> = {
  // a cap above the path of rounds, ending in the offer
  student: [
    { d: "M30 88C42 88 48 76 60 76S78 58 90 58", kind: "dim", dash: "1.5 4.5" },
    { d: c(30, 88, 4), kind: "main" },
    { d: c(60, 76, 4), kind: "main" },
    { d: c(90, 58, 5.5), kind: "solid" },
    { d: "M46 22 72 33 46 44 20 33Z", kind: "glass" },
    { d: "M33 40v9c0 5.5 26 5.5 26 0v-9M72 33v13", kind: "main" },
    { d: c(72, 49, 2.2), kind: "solid" },
    { d: "M97 28v8M93 32h8", kind: "dim" },
  ],
  // a building and its batch readiness gauge
  campus: [
    { d: "M20 44 48 28 76 44Z", kind: "glass" },
    { d: "M24 50h48M32 56v24M43 56v24M54 56v24M65 56v24M22 86h52", kind: "main" },
    { d: c(88, 84, 16), kind: "glass" },
    { d: c(88, 84, 10), kind: "dim" },
    { d: c(88, 84, 10), kind: "main", dash: "47 63", transform: "rotate(-90 88 84)" },
  ],
  // a briefcase and the swap that takes you to the next job
  professional: [
    { d: "M24 40C30 20 90 20 96 40M89 36l7 4 3-8", kind: "main" },
    { d: "M34 54h52a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8V62a8 8 0 0 1 8-8Z", kind: "glass" },
    { d: "M50 54v-5a5 5 0 0 1 5-5h10a5 5 0 0 1 5 5v5M26 70h68", kind: "main" },
    { d: "M55 66h10v9H55Z", kind: "solid" },
  ],
  // a shortlist: the person chosen, the one behind, a check
  hiring: [
    { d: c(78, 40, 8), kind: "dim" },
    { d: "M62 76c0-10 6-15 16-15s16 5 16 15", kind: "dim" },
    { d: c(46, 44, 10), kind: "glass" },
    { d: c(46, 44, 10), kind: "main" },
    { d: "M22 92c0-15 9-22 24-22s24 7 24 22", kind: "main" },
    { d: c(86, 86, 12), kind: "glass" },
    { d: "M80 86l4 4 8-9", kind: "main" },
  ],
  // a terminal and the track of lessons beneath it
  bootcamp: [
    { d: "M34 30h52a10 10 0 0 1 10 10v36a10 10 0 0 1-10 10H34A10 10 0 0 1 24 76V40a10 10 0 0 1 10-10Z", kind: "glass" },
    { d: "M24 44h72M36 56l9 7-9 7M52 70h24M24 94h15M43 94h15M62 94h15", kind: "main" },
    { d: "M81 94h15", kind: "dim" },
    { d: `${c(33, 37, 1.8)}${c(40, 37, 1.8)}${c(47, 37, 1.8)}`, kind: "solidDim" },
  ],
  // a calendar with the booked day lit
  schedule: [
    { d: "M38 32h44a12 12 0 0 1 12 12v38a12 12 0 0 1-12 12H38a12 12 0 0 1-12-12V44a12 12 0 0 1 12-12Z", kind: "glass" },
    { d: "M26 50h68M44 26v12M76 26v12", kind: "main" },
    { d: `${c(40, 64, 1.7)}${c(52, 64, 1.7)}${c(76, 64, 1.7)}${c(40, 78, 1.7)}${c(52, 78, 1.7)}${c(82, 78, 1.7)}`, kind: "solidDim" },
    { d: "M58 70h14a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H58a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3Z", kind: "solid" },
  ],
  // a lens over a list of roles
  find: [
    { d: "M72 34h22M78 44h16", kind: "dim" },
    { d: c(50, 54, 20), kind: "glass" },
    { d: "M67 69 86 88", kind: "main" },
    { d: "M40 48a12 12 0 0 1 10-8", kind: "dim" },
  ],
  // a route that climbs to a flag
  track: [
    { d: "M28 88 46 62 70 72 90 42", kind: "dim" },
    { d: c(28, 88, 4.5), kind: "main" },
    { d: c(46, 62, 4.5), kind: "main" },
    { d: c(70, 72, 4.5), kind: "main" },
    { d: "M90 42V24l14 6-14 6", kind: "main" },
    { d: c(90, 42, 3.5), kind: "solid" },
  ],
  // one profile fed by several sources
  sources: [
    { d: "M60 62 28 40M60 62 92 40M60 62 60 98", kind: "dim" },
    { d: c(60, 62, 13), kind: "glass" },
    { d: c(60, 62, 3.4), kind: "solid" },
    { d: c(28, 40, 6), kind: "main" },
    { d: c(92, 40, 6), kind: "main" },
    { d: c(60, 98, 6), kind: "main" },
  ],
  // code and the dashes of a practice line
  practice: [
    { d: "M34 94h14M54 94h10M70 94h16", kind: "dim" },
    { d: "M44 42 26 60l18 18M76 42l18 18-18 18M66 38 54 82", kind: "main" },
  ],
  // two overlapping speech bubbles
  share: [
    { d: "M46 52h44a10 10 0 0 1 10 10v16a10 10 0 0 1-10 10H78l-8 8v-8H46a10 10 0 0 1-10-10V62a10 10 0 0 1 10-10Z", kind: "dim" },
    { d: "M30 28h46a12 12 0 0 1 12 12v22a12 12 0 0 1-12 12H48l-12 11v-11h-6A12 12 0 0 1 18 62V40a12 12 0 0 1 12-12Z", kind: "glass" },
    { d: "M32 44h40M32 56h24", kind: "main" },
  ],
  // a resume: a profile and its lines
  resume: [
    { d: "M40 22h30l20 20v46a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8Z", kind: "glass" },
    { d: "M70 22v14a6 6 0 0 0 6 6h14", kind: "main" },
    { d: c(52, 54, 7), kind: "main" },
    { d: "M40 78c0-8 5-12 12-12s12 4 12 12M68 54h12M68 64h8", kind: "main" },
    { d: "M42 90h34", kind: "dim" },
  ],
  // a repository: two branches that merge
  github: [
    { d: "M40 40v40M80 56c0 14-14 18-40 22", kind: "main" },
    { d: c(40, 34, 6), kind: "glass" },
    { d: c(40, 86, 6), kind: "glass" },
    { d: c(80, 50, 6), kind: "glass" },
    { d: c(40, 34, 6), kind: "main" },
    { d: c(40, 86, 6), kind: "main" },
    { d: c(80, 50, 6), kind: "solid" },
  ],
  // a portfolio: a browser window with a globe
  portfolio: [
    { d: "M34 28h52a10 10 0 0 1 10 10v42a10 10 0 0 1-10 10H34A10 10 0 0 1 24 80V38a10 10 0 0 1 10-10Z", kind: "glass" },
    { d: "M24 44h72", kind: "main" },
    { d: `${c(33, 36, 1.8)}${c(40, 36, 1.8)}${c(47, 36, 1.8)}`, kind: "solidDim" },
    { d: c(60, 68, 12), kind: "main" },
    { d: "M48 68h24M60 56c-7 7-7 17 0 24M60 56c7 7 7 17 0 24", kind: "dim" },
  ],
  // a stack of layers
  layers: [
    { d: "M60 28 94 46 60 64 26 46Z", kind: "glass" },
    { d: "M60 28 94 46 60 64 26 46Z", kind: "main" },
    { d: "M26 62 60 80 94 62", kind: "main" },
    { d: "M26 78 60 96 94 78", kind: "dim" },
  ],
  // bars and a trend
  chart: [
    { d: "M30 96h60", kind: "dim" },
    { d: "M34 58 52 42 70 54 92 30", kind: "dim" },
    { d: "M38 90V66M56 90V50M74 90V72", kind: "main" },
    { d: c(92, 30, 4), kind: "solid" },
  ],
  // a trophy
  trophy: [
    { d: "M42 28h36v24a18 18 0 0 1-36 0Z", kind: "glass" },
    { d: "M42 34H30c0 13 6 19 14 20M78 34h12c0 13-6 19-14 20M60 70v14M46 94h28", kind: "main" },
    { d: "M42 28h36v24a18 18 0 0 1-36 0Z", kind: "main" },
  ],
  // a timed assessment: a clipboard of checks
  assessment: [
    { d: "M42 30h36a10 10 0 0 1 10 10v44a10 10 0 0 1-10 10H42a10 10 0 0 1-10-10V40a10 10 0 0 1 10-10Z", kind: "glass" },
    { d: "M50 30v-5h20v5M42 54l5 5 9-10M42 76l5 5 9-10", kind: "main" },
    { d: "M64 54h14M64 76h14", kind: "dim" },
  ],
  // a system: boxes joined by connectors
  design: [
    { d: "M44 24h32a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6V30a6 6 0 0 1 6-6Z", kind: "glass" },
    { d: "M24 74h28a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6v-6a6 6 0 0 1 6-6Z", kind: "glass" },
    { d: "M68 74h28a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6H68a6 6 0 0 1-6-6v-6a6 6 0 0 1 6-6Z", kind: "glass" },
    { d: "M60 46v14M38 74V60h44v14", kind: "main" },
  ],
  // company reviews: a star
  reviews: [
    { d: "M60 26l9 19 21 3-15 15 4 21-19-10-19 10 4-21-15-15 21-3Z", kind: "glass" },
    { d: "M60 26l9 19 21 3-15 15 4 21-19-10-19 10 4-21-15-15 21-3Z", kind: "main" },
  ],
  // a video
  video: [
    { d: "M36 32h48a14 14 0 0 1 14 14v28a14 14 0 0 1-14 14H36A14 14 0 0 1 22 74V46a14 14 0 0 1 14-14Z", kind: "glass" },
    { d: "M52 48v24l22-12Z", kind: "solid" },
  ],
};

/**
 * A bespoke InterviewIQ icon on smoked glass: a graphite tile with a lit rim, and a symbol drawn
 * in luminous white line with a dimmer supporting layer and frosted glass panels. Monochrome.
 * Decorative (aria-hidden).
 */
export function SmokedIcon({ name, size = 56, className }: { name: SmokedIconName; size?: number; className?: string }) {
  const id = `si-${name}`;
  const shapes = ICONS[name];
  const line = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  // Thin lines get heavier as the icon shrinks, so a 40px tile stays crisp.
  const w = size < 64 ? 3.6 : 2.6;
  return (
    <svg aria-hidden viewBox="0 0 120 120" width={size} height={size} className={className}>
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5A5854" />
          <stop offset=".55" stopColor="#2B2A28" />
          <stop offset="1" stopColor="#0F0F0E" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".26" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".12" />
          <stop offset="1" stopColor="#000" stopOpacity=".5" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".2" />
          <stop offset="1" stopColor="#fff" stopOpacity=".05" />
        </linearGradient>
        <filter id={`${id}-bloom`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <rect width="120" height="120" rx="30" fill={`url(#${id}-tile)`} />
      <rect x="9" y="5" width="102" height="52" rx="26" fill={`url(#${id}-sheen)`} opacity=".65" />
      <rect x="1" y="1" width="118" height="118" rx="29" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="2" />

      {shapes.map((s, i) => {
        const common = { d: s.d, transform: s.transform, strokeDasharray: s.dash };
        if (s.kind === "glass")
          return <path key={i} {...common} fill={`url(#${id}-glass)`} stroke="#fff" strokeOpacity=".55" strokeWidth={w * 0.6} strokeLinejoin="round" />;
        if (s.kind === "dim") return <path key={i} {...common} {...line} stroke="#fff" strokeOpacity=".42" strokeWidth={w} />;
        if (s.kind === "solidDim") return <path key={i} {...common} fill="#fff" fillOpacity=".5" stroke="none" />;
        if (s.kind === "solid")
          return (
            <g key={i}>
              <path d={s.d} transform={s.transform} fill="#fff" opacity=".7" filter={`url(#${id}-bloom)`} />
              <path d={s.d} transform={s.transform} fill="#fff" />
            </g>
          );
        return (
          <g key={i}>
            <path d={s.d} transform={s.transform} strokeDasharray={s.dash} {...line} stroke="#fff" strokeOpacity=".75" strokeWidth={w + 4} filter={`url(#${id}-bloom)`} />
            <path {...common} {...line} stroke="#fff" strokeWidth={w} />
          </g>
        );
      })}
    </svg>
  );
}
