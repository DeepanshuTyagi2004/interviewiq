import * as React from "react";
import type { PersonaKind } from "./PersonaArt";

export type GlyphVariant = "line" | "smoked" | "engraved" | "duotone" | "etched";

/** Precise 120-grid symbols, drawn as monoline paths (the weight of an SF Symbol). */
const SYMBOLS: Record<PersonaKind, { main: string; detail?: string; fill?: string }> = {
  // mortarboard, cap base, tassel
  student: {
    main: "M60 33 94 48 60 63 26 48Z",
    detail: "M43 56v13c0 7 34 7 34 0V56M94 48v18",
    fill: "M60 33 94 48 60 63 26 48Z",
  },
  // pediment, entablature, four columns, base
  campus: {
    main: "M28 47 60 31l32 16Z",
    detail: "M32 54h56M40 59v22M53 59v22M67 59v22M80 59v22M30 87h60",
    fill: "M28 47 60 31l32 16Z",
  },
  // briefcase body, handle, clasp line
  professional: {
    main: "M30 51h60a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8V59a8 8 0 0 1 8-8Z",
    detail: "M47 51v-6a6 6 0 0 1 6-6h14a6 6 0 0 1 6 6v6M22 68h76M54 64h12v9H54Z",
    fill: "M30 51h60a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8V59a8 8 0 0 1 8-8Z",
  },
  // shortlist card with rows and a check
  hiring: {
    main: "M42 36h36a12 12 0 0 1 12 12v26a12 12 0 0 1-12 12H42a12 12 0 0 1-12-12V48a12 12 0 0 1 12-12Z",
    detail: "M56 52h22M56 66h12M43 52h.01M43 66h.01M71 78l5 5 11-12",
    fill: "M42 36h36a12 12 0 0 1 12 12v26a12 12 0 0 1-12 12H42a12 12 0 0 1-12-12V48a12 12 0 0 1 12-12Z",
  },
  // terminal window, prompt, cursor line
  bootcamp: {
    main: "M38 35h44a12 12 0 0 1 12 12v28a12 12 0 0 1-12 12H38A12 12 0 0 1 26 75V47a12 12 0 0 1 12-12Z",
    detail: "M40 55l11 8-11 8M58 72h20",
    fill: "M38 35h44a12 12 0 0 1 12 12v28a12 12 0 0 1-12 12H38A12 12 0 0 1 26 75V47a12 12 0 0 1 12-12Z",
  },
};

/**
 * Audience symbols: a thin-line glyph on a liquid-glass tile, strictly monochrome. Five treatments
 * (`variant`): ink line on pearl, white line on smoked glass, a deeply engraved glyph pressed into
 * pearl, a duotone glyph with a graphite glass fill, and an etched glyph cut into smoked glass.
 * Decorative (aria-hidden).
 */
export function PersonaGlyph({
  kind,
  variant = "line",
  size = 104,
  className,
}: {
  kind: PersonaKind;
  variant?: GlyphVariant;
  size?: number;
  className?: string;
}) {
  const id = `gl-${variant}-${kind}`;
  const sym = SYMBOLS[kind];
  const dark = variant === "smoked" || variant === "etched";
  const engraved = variant === "engraved" || variant === "etched";
  const stroke = variant === "etched" ? "#050504" : variant === "smoked" ? "#FFFFFF" : variant === "engraved" ? "#8A867F" : `url(#${id}-ink)`;
  const common = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const w = 2.6;
  return (
    <svg aria-hidden viewBox="0 0 120 120" width={size} height={size} className={className}>
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          {dark ? (
            <>
              <stop offset="0" stopColor="#5A5854" />
              <stop offset=".55" stopColor="#2B2A28" />
              <stop offset="1" stopColor="#0F0F0E" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset=".6" stopColor="#F4F2EE" />
              <stop offset="1" stopColor="#DDD9D2" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={dark ? 0.26 : 0.95} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={dark ? 0.55 : 1} />
          <stop offset=".5" stopColor="#fff" stopOpacity=".12" />
          <stop offset="1" stopColor={dark ? "#000" : "#6B6862"} stopOpacity={dark ? 0.5 : 0.32} />
        </linearGradient>
        <linearGradient id={`${id}-ink`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2A2825" />
          <stop offset="1" stopColor="#57534D" />
        </linearGradient>
        <filter id={`${id}-lift`} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.4" floodColor={dark ? "#000" : "#2A2723"} floodOpacity={dark ? 0.5 : 0.22} />
        </filter>
        <filter id={`${id}-bloom`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {/* tile */}
      <rect width="120" height="120" rx="30" fill={`url(#${id}-tile)`} />
      <rect x="9" y="5" width="102" height="52" rx="26" fill={`url(#${id}-sheen)`} opacity=".65" />
      <rect x="1" y="1" width="118" height="118" rx="29" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="2" />

      {/* the symbol */}
      {engraved ? (
        <g {...common} strokeWidth={w + 0.6}>
          {/* lit lower lip of the cut */}
          <g transform="translate(0 1.6)" stroke="#fff" opacity={variant === "etched" ? 0.38 : 0.95}>
            <path d={sym.main} />
            {sym.detail ? <path d={sym.detail} /> : null}
          </g>
          {/* shadowed upper wall of the cut */}
          <g transform="translate(0 -0.9)" stroke={variant === "etched" ? "#000" : "#3F3B35"} opacity={variant === "etched" ? 0.7 : 0.6}>
            <path d={sym.main} />
            {sym.detail ? <path d={sym.detail} /> : null}
          </g>
          {/* the floor of the cut */}
          <g stroke={stroke}>
            <path d={sym.main} />
            {sym.detail ? <path d={sym.detail} /> : null}
          </g>
        </g>
      ) : (
        <g>
          {dark ? (
            <g {...common} stroke="#fff" strokeWidth={w + 4} opacity=".5" filter={`url(#${id}-bloom)`}>
              <path d={sym.main} />
              {sym.detail ? <path d={sym.detail} /> : null}
            </g>
          ) : null}
          {variant === "duotone" && sym.fill ? <path d={sym.fill} fill="#2A2825" fillOpacity=".12" stroke="none" /> : null}
          <g {...common} stroke={stroke} strokeWidth={w}>
            <path d={sym.main} />
            {sym.detail ? <path d={sym.detail} /> : null}
          </g>
        </g>
      )}

    </svg>
  );
}
