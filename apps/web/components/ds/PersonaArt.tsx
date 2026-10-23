import * as React from "react";
import { HUES } from "./palette";

export type PersonaKind = "student" | "campus" | "professional" | "hiring" | "bootcamp";
export type PersonaVariant = "pearl" | "smoked" | "crystal" | "layered";

interface Theme {
  tile: readonly [string, string, string];
  tileRim: readonly [string, string, string];
  /** Glass body: [top, mid, bottom] colours and opacities. */
  glass: readonly [readonly [string, number], readonly [string, number], readonly [string, number]];
  rim: readonly [readonly [string, number], readonly [string, number], readonly [string, number]];
  rimWidth: number;
  /** The solid accent material (cap, pediment, clasp). */
  dark: readonly [string, string];
  /** Small details drawn on top of glass. */
  ink: string;
  inkOpacity: readonly [number, number, number];
  glowOpacity: number;
  /** Draw an offset champagne ghost of every object behind it, for parallax depth. */
  ghost: boolean;
}

const THEMES: Record<PersonaVariant, Theme> = {
  /** A: frosted pearl glass on a soft pearl tile; graphite glass accents. */
  pearl: {
    tile: ["#FFFFFF", "#F5EDDD", "#E3D6BD"],
    tileRim: ["#FFFFFF", "#FFFFFF", "#7A6548"],
    glass: [["#FFFFFF", 0.98], ["#F8F7F4", 0.86], ["#E4E2DD", 0.78]],
    rim: [["#FFFFFF", 1], ["#FFFFFF", 0.5], ["#8F8C86", 0.5]],
    rimWidth: 1,
    dark: ["#5E5951", "#1A1814"],
    ink: "#3B3834",
    inkOpacity: [0.78, 0.3, 0.22],
    glowOpacity: 0.95,
    ghost: false,
  },
  /** B: smoked glass on a graphite tile; the objects glow white. */
  smoked: {
    tile: ["#55534F", "#292826", "#0F0F0E"],
    tileRim: ["#FFFFFF", "#FFFFFF", "#000000"],
    glass: [["#FFFFFF", 0.34], ["#FFFFFF", 0.14], ["#FFFFFF", 0.2]],
    rim: [["#FFFFFF", 0.95], ["#FFFFFF", 0.22], ["#FFFFFF", 0.5]],
    rimWidth: 1,
    dark: ["#FFFFFF", "#C9C7C2"],
    ink: "#FFFFFF",
    inkOpacity: [0.9, 0.5, 0.35],
    glowOpacity: 0.7,
    ghost: false,
  },
  /** C: clear crystal: nearly transparent bodies defined by bright refracting rims. */
  crystal: {
    tile: ["#FFFFFF", "#F3EBDC", "#DDD0B8"],
    tileRim: ["#FFFFFF", "#FFFFFF", "#7A6548"],
    glass: [["#FFFFFF", 0.62], ["#FFFFFF", 0.14], ["#E9E7E2", 0.34]],
    rim: [["#FFFFFF", 1], ["#FFFFFF", 0.7], ["#9A9791", 0.85]],
    rimWidth: 1.5,
    dark: ["#6A655C", "#2B2823"],
    ink: "#3B3834",
    inkOpacity: [0.7, 0.3, 0.2],
    glowOpacity: 0.85,
    ghost: false,
  },
  /** D: layered depth: silver tile; every object sits on an offset grey ghost. */
  layered: {
    tile: ["#ECEAE6", "#D3D0CA", "#A9A6A0"],
    tileRim: ["#FFFFFF", "#FFFFFF", "#5E5B56"],
    glass: [["#FFFFFF", 0.96], ["#F6F5F2", 0.82], ["#E2E0DB", 0.7]],
    rim: [["#FFFFFF", 1], ["#FFFFFF", 0.5], ["#8F8C86", 0.55]],
    rimWidth: 1,
    dark: ["#4E4A43", "#171510"],
    ink: "#3B3834",
    inkOpacity: [0.78, 0.3, 0.22],
    glowOpacity: 0.6,
    ghost: true,
  },
};

/** The one coloured accent in each scene: an orb in a hue from the shared palette. */
const ORB_HUE: Record<PersonaKind, number> = { student: 0, campus: 1, professional: 3, hiring: 2, bootcamp: 5 };

function Scene({ kind, id, t }: { kind: PersonaKind; id: string; t: Theme }) {
  const g = `url(#${id}-glass)`;
  const rim = `url(#${id}-rim)`;
  const dk = `url(#${id}-dark)`;
  const gold = `url(#${id}-gold)`;
  const orb = `url(#${id}-orb)`;
  const silver = "#9C9993";
  const bloom = `url(#${id}-bloom)`;
  const [i1, i2, i3] = t.inkOpacity;
  return (
    <>
      {kind === "student" ? (
        <>
          <path d="M20 76 58 82v24L20 100Z" fill={g} stroke={rim} strokeWidth={t.rimWidth} />
          <path d="M100 76 62 82v24l38-6Z" fill={g} stroke={rim} strokeWidth={t.rimWidth} />
          <path d="M28 86 50 90M28 93 50 97M70 90 92 86M70 97 92 93" stroke={silver} strokeOpacity=".7" strokeLinecap="round" />
          <path d="M42 50v13c10 8 26 8 36 0V50" fill={dk} stroke={rim} strokeOpacity=".5" />
          <path d="M60 20 102 37 60 54 18 37Z" fill={dk} stroke={rim} strokeOpacity=".6" />
          <path d="M60 23 92 36 60 39 28 36Z" fill="#fff" fillOpacity=".22" />
          <path d="M98 38v20" stroke={gold} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="98" cy="62" r="5" fill={orb} />
        </>
      ) : null}
      {kind === "campus" ? (
        <>
          <path d="M60 18 104 41H16Z" fill={dk} stroke={rim} strokeOpacity=".6" />
          <path d="M60 21 94 39H26Z" fill="#fff" fillOpacity=".14" />
          <circle cx="60" cy="33" r="5.5" fill={orb} />
          {[26, 45, 64, 83].map((x) => (
            <g key={x}>
              <rect x={x} y="47" width="11" height="39" rx="4" fill={g} stroke={rim} strokeWidth={t.rimWidth} />
              <rect x={x + 2.5} y="51" width="2.2" height="30" rx="1.1" fill="#fff" fillOpacity=".85" />
            </g>
          ))}
          <rect x="16" y="87" width="88" height="10" rx="5" fill={gold} stroke={rim} strokeOpacity=".6" />
          <rect x="10" y="99" width="100" height="8" rx="4" fill={g} stroke={rim} strokeWidth={t.rimWidth} />
        </>
      ) : null}
      {kind === "professional" ? (
        <>
          <path d="M45 58v-8a7 7 0 0 1 7-7h16a7 7 0 0 1 7 7v8" fill="none" stroke={dk} strokeWidth="5" strokeLinecap="round" />
          <rect x="20" y="56" width="80" height="50" rx="13" fill={g} stroke={rim} strokeWidth={t.rimWidth} />
          <rect x="20" y="77" width="80" height="9" fill={gold} fillOpacity=".95" />
          <rect x="52" y="72" width="16" height="19" rx="5" fill={dk} stroke={rim} strokeOpacity=".5" />
          <rect x="26" y="60" width="68" height="3" rx="1.5" fill="#fff" fillOpacity=".7" />
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M70 40 84 27l10 7 14-15" stroke="#fff" strokeWidth="6" opacity=".8" filter={bloom} />
            <path d="M70 40 84 27l10 7 14-15M100 19h8v8" stroke={gold} strokeWidth="3.4" />
          </g>
          <circle cx="22" cy="32" r="6" fill={orb} />
        </>
      ) : null}
      {kind === "hiring" ? (
        <>
          <rect x="26" y="84" width="68" height="22" rx="10" fill={g} fillOpacity=".5" stroke={rim} strokeOpacity=".6" />
          <rect x="21" y="57" width="78" height="24" rx="11" fill={g} fillOpacity=".75" stroke={rim} strokeOpacity=".8" />
          <rect x="15" y="21" width="90" height="32" rx="13" fill={g} stroke={rim} strokeWidth={t.rimWidth} />
          <circle cx="33" cy="37" r="8.5" fill={orb} />
          <rect x="48" y="30" width="34" height="4.5" rx="2.25" fill={t.ink} fillOpacity={i1} />
          <rect x="48" y="40" width="22" height="4.5" rx="2.25" fill={t.ink} fillOpacity={i2} />
          <circle cx="91" cy="37" r="9.5" fill={dk} stroke={rim} strokeOpacity=".55" />
          <path d="m86.5 37 3.2 3.2 5.6-6.4" fill="none" stroke={t.dark[0] === "#FFFFFF" ? "#1A1814" : "#fff"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="30" y="66" width="30" height="4" rx="2" fill={t.ink} fillOpacity={i3} />
        </>
      ) : null}
      {kind === "bootcamp" ? (
        <>
          <rect x="22" y="24" width="76" height="54" rx="10" fill={dk} stroke={rim} strokeOpacity=".6" />
          <rect x="27" y="29" width="66" height="44" rx="6" fill="#151412" />
          <rect x="27" y="29" width="66" height="14" rx="6" fill="#fff" fillOpacity=".08" />
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="m50 44-9 7 9 7M70 44l9 7-9 7M64 42l-8 18" stroke="#fff" strokeWidth="6" opacity=".7" filter={bloom} />
            <path d="m50 44-9 7 9 7M70 44l9 7-9 7M64 42l-8 18" stroke={gold} strokeWidth="3" />
          </g>
          <path d="M12 81h96v3a10 10 0 0 1-10 10H22A10 10 0 0 1 12 84Z" fill={g} stroke={rim} strokeWidth={t.rimWidth} />
          <rect x="46" y="83" width="28" height="3.5" rx="1.75" fill="#6B6862" fillOpacity=".35" />
          <circle cx="100" cy="28" r="8" fill={orb} />
        </>
      ) : null}
    </>
  );
}

/**
 * Small liquid-glass scenes for the audience cards: a student, a campus, a professional, a hiring
 * team and a bootcamp. Built the way Apple builds glass icons: translucent objects with soft
 * gradients and a lit rim instead of an outline. Strictly monochrome (white, silver, graphite glass)
 * with one small coloured orb per scene as the only accent. Four material treatments (`variant`)
 * share one set of drawings. Decorative (aria-hidden).
 */
export function PersonaArt({
  kind,
  variant = "pearl",
  size = 104,
  className,
}: {
  kind: PersonaKind;
  variant?: PersonaVariant;
  size?: number;
  className?: string;
}) {
  const t = THEMES[variant];
  const id = `pg-${variant}-${kind}`;
  const orbTones = HUES[ORB_HUE[kind]].orb;
  const stops = (s: Theme["glass"]) => s.map(([c, o], i) => <stop key={i} offset={[0, 0.55, 1][i]} stopColor={c} stopOpacity={o} />);
  return (
    <svg aria-hidden viewBox="0 0 120 120" width={size} height={size} className={className}>
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.tile[0]} />
          <stop offset=".6" stopColor={t.tile[1]} />
          <stop offset="1" stopColor={t.tile[2]} />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={variant === "smoked" ? 0.28 : 0.95} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-trim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.tileRim[0]} stopOpacity={variant === "smoked" ? 0.55 : 1} />
          <stop offset=".5" stopColor={t.tileRim[1]} stopOpacity=".15" />
          <stop offset="1" stopColor={t.tileRim[2]} stopOpacity={variant === "smoked" ? 0.5 : 0.35} />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0" y2="1">{stops(t.glass)}</linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">{stops(t.rim)}</linearGradient>
        <linearGradient id={`${id}-dark`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.dark[0]} />
          <stop offset="1" stopColor={t.dark[1]} />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".5" stopColor="#D8D6D2" />
          <stop offset="1" stopColor="#9C9993" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={t.glowOpacity} />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-orb`} cx=".32" cy=".26" r=".85">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".3" stopColor={orbTones[0]} />
          <stop offset=".7" stopColor={orbTones[1]} />
          <stop offset="1" stopColor={orbTones[2]} />
        </radialGradient>
        <filter id={`${id}-shadow`} x="-25%" y="-25%" width="150%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor={variant === "smoked" ? "#000" : "#2A2723"} floodOpacity={variant === "smoked" ? 0.5 : 0.28} />
        </filter>
        <filter id={`${id}-bloom`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <filter id={`${id}-ghost`} x="-20%" y="-20%" width="140%" height="140%">
          <feColorMatrix type="matrix" values="0 0 0 0 0.62  0 0 0 0 0.61  0 0 0 0 0.58  0 0 0 0.9 0" />
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      <rect width="120" height="120" rx="30" fill={`url(#${id}-tile)`} />
      <circle cx="60" cy="70" r="40" fill={`url(#${id}-glow)`} />
      <rect x="9" y="5" width="102" height="52" rx="26" fill={`url(#${id}-sheen)`} opacity=".65" />
      <rect x="1" y="1" width="118" height="118" rx="29" fill="none" stroke={`url(#${id}-trim)`} strokeWidth="2" />

      {t.ghost ? (
        <g transform="translate(-4 6)" opacity=".55" filter={`url(#${id}-ghost)`}>
          <Scene kind={kind} id={id} t={t} />
        </g>
      ) : null}
      <g filter={`url(#${id}-shadow)`}>
        <Scene kind={kind} id={id} t={t} />
      </g>
    </svg>
  );
}
