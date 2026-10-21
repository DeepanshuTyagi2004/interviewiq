"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import { FORM_HOLD_MS, MORPH_MS, geometryFor, nextForm, type Box, type MascotForm, type MascotMood } from "./forms";

export interface BarsMascotProps {
  mood?: MascotMood;
  /** A fixed form. Omit it to run the morph loop (Trio, Hopper, Jelly, Bloom, Trio...). */
  form?: MascotForm;
  /** Size in px of the 120-unit drawing. Hops, jumps and the walk bleed outside it, so leave room. */
  size?: number;
  /** Play the mood once, then settle to idle (used for laughing). */
  once?: boolean;
  /** Accessible label. Omit it and the mascot is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

/** How long a `once` mood plays: three jumps of the laugh. */
const ONCE_MS = 2800;

/** SVG geometry properties are CSS properties, so React inline styles can drive (and transition) them. */
function css(o: Record<string, string | number>): CSSProperties {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? `${v}px` : v])) as CSSProperties;
}
/** The same box as SVG attributes, so an engine without CSS geometry properties still draws (it just snaps). */
const rectAttrs = (b: Box) => ({ x: b.x, y: b.y, width: b.w, height: b.h, rx: b.r, ry: b.r });
const rectStyle = (b: Box) => css({ x: b.x, y: b.y, width: b.w, height: b.h, rx: b.r, ry: b.r });

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** The form to show: fixed, or stepping round the loop (still on the Trio under reduced motion). */
function useForm(fixed: MascotForm | undefined, reduced: boolean): MascotForm {
  const [form, setForm] = useState<MascotForm>("trio");
  const looping = fixed === undefined && !reduced;
  useEffect(() => {
    if (!looping) return;
    const id = window.setInterval(() => setForm((f) => nextForm(f)), FORM_HOLD_MS + MORPH_MS);
    return () => window.clearInterval(id);
  }, [looping]);
  if (fixed !== undefined) return fixed;
  return reduced ? "trio" : form;
}

/** The mood to show: the given one, or, with `once`, the given one for a moment and then idle. */
function useMood(mood: MascotMood, once: boolean): MascotMood {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!once) return;
    const t = window.setTimeout(() => setSettled(true), ONCE_MS);
    return () => window.clearTimeout(t);
  }, [mood, once]);
  return once && settled ? "idle" : mood;
}

/**
 * The bars mascot (spec §5.6): the logo's three audio bars with their own eyes. One SVG; each form is a
 * geometry the bars morph to (CSS transitions on x, y, width, height, rx), and each mood is a set of
 * motion amplitudes (see the `mq-` rules in globals.css). Eyes live in their bar's group so they move
 * with it. Without `form` it morphs through Hopper, Jelly and Bloom and back to the Trio.
 */
export function BarsMascot({ mood = "idle", form, size = 120, once = false, label, className }: BarsMascotProps) {
  const reduced = usePrefersReducedMotion();
  const activeForm = useForm(form, reduced);
  const activeMood = useMood(mood, once);
  const gooId = `mq-goo-${useId().replace(/\W/g, "")}`;
  const g = geometryFor(activeForm, activeMood);
  const gooOn = activeForm === "jelly" && activeMood !== "thinking";
  const DROP_R = [3.5, 5, 4] as const;

  return (
    <svg
      className={cn("mq", className)}
      data-form={activeForm}
      data-mood={activeMood}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={{ "--mq-dur": `${MORPH_MS}ms` } as CSSProperties}
    >
      <defs>
        <filter id={gooId} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6" />
        </filter>
      </defs>

      <g className="mq-walk">
        <ellipse className="mq-shadow" cx="60" cy="106" rx="36" ry="3.5" />
        <g className="mq-hop">
          <g className="mq-all">
            <g className="mq-lean">
              <g className="mq-tilt">
                <g className="mq-leg mq-leg-l"><rect className="mq-ink" x="50" y="90" width="5" height="13" rx="2.5" /></g>
                <g className="mq-leg mq-leg-r"><rect className="mq-ink" x="65" y="90" width="5" height="13" rx="2.5" /></g>

                {([0, 1, 2] as const).map((i) => {
                  const bar = g.bars[i];
                  const n = i + 1;
                  return (
                    <g key={n} className={`mq-bar mq-bar-${n}`}>
                      <g className={`mq-arm mq-arm-${n}`}>
                        <g className="mq-goo" style={gooOn ? { filter: `url(#${gooId})` } : undefined}>
                          <rect className="mq-ink mq-g" {...rectAttrs(bar)} style={rectStyle(bar)} />
                          <circle className="mq-ink mq-drop" cx={bar.x + bar.w / 2} cy={bar.y} r={DROP_R[i]} style={css({ cx: bar.x + bar.w / 2, cy: bar.y, r: DROP_R[i] })} />
                        </g>
                        <g className="mq-eyes mq-g" style={{ opacity: g.eyeOn[i] }}>
                          <g className={`mq-look mq-look-${n}`}>
                            <rect className={`mq-eye mq-g mq-blink mq-d${n}`} {...rectAttrs(g.eyes[i * 2]!)} style={rectStyle(g.eyes[i * 2]!)} />
                            <rect className={`mq-eye mq-g mq-blink mq-d${n}`} {...rectAttrs(g.eyes[i * 2 + 1]!)} style={rectStyle(g.eyes[i * 2 + 1]!)} />
                          </g>
                        </g>
                      </g>
                      {n === 2 ? (
                        <>
                          <g className="mq-face mq-g" style={css({ translate: `0 ${g.faceDy}px` })}>
                            <g className="mq-happy">
                              <path d="M53 44 q2.5 -4 5 0 M61.5 44 q2.5 -4 5 0" />
                              <path d="M55 54 q5 5 10 0" />
                            </g>
                            <path className="mq-xeyes" d="M53 40 l4 4 M57 40 l-4 4 M62 40 l4 4 M66 40 l-4 4" />
                          </g>
                          <ellipse className="mq-eye mq-mouth mq-g" cx="60" cy={g.mouth.cy} rx={g.mouth.rx} ry={g.mouth.ry} style={css({ cy: g.mouth.cy, rx: g.mouth.rx, ry: g.mouth.ry })} />
                          <g className="mq-bandage-pos mq-g" style={css({ translate: `0 ${g.topY - 26}px` })}>
                            <g className="mq-bandage">
                              <rect x="52" y="24" width="16" height="6" rx="3" transform="rotate(35 60 27)" />
                              <rect x="52" y="24" width="16" height="6" rx="3" transform="rotate(-35 60 27)" />
                            </g>
                          </g>
                        </>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </g>
          </g>
        </g>
      </g>

      <g className="mq-stars">
        <path d="M0 -8 l2 5 5 1 -4 3 1 5 -4 -3 -4 3 1 -5 -4 -3 5 -1z" />
      </g>
    </svg>
  );
}
