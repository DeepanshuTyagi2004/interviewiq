"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { CatArm, CatBody, CatHand, CatPaw, CatShadow } from "./Cat";
import { clamp } from "./motion";
import { fill } from "./palette";
import { SCENES } from "./scenes";
import { createStage } from "./stage";

/** Chapter ids, in play order (tests and previews pick one with `setIndex`). */
export const PREP_ANIMATION_SETS = SCENES.map((s) => s.id);

/** Seconds each chapter fades in and out over. */
const FADE = 0.3;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const nextFrame = (cb: (now: number) => void): number =>
  typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(cb) : window.setTimeout(() => cb(performance.now()), 16);

const cancelFrame = (id: number) => (typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame(id) : window.clearTimeout(id));

/**
 * The cat that keeps the candidate company while the blueprint is prepared (spec §9.4). Five ~12 s
 * chapters (reader, card sorter, note-taker, architect, warm-up) play in turn from a random start; in
 * each the cat walks about, trips, laughs and pulls faces (pose.ts).
 * Each frame is written straight to the SVG (stage.ts), so React renders only when the chapter changes.
 * Decorative (`aria-hidden`); `prefers-reduced-motion` shows one still per mount; requestAnimationFrame
 * pauses with the tab. `freezeAt` pins a chapter time (tests and previews).
 */
export function PrepAnimation({ setIndex, freezeAt, className }: { setIndex?: number; freezeAt?: number; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Picked after mount, so the server render and the first client render match.
  const [index, setIndexState] = useState<number | null>(setIndex ?? null);
  const [reduced, setReduced] = useState(false);
  const sceneRef = useRef<SVGGElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    setReduced(prefersReducedMotion());
    setIndexState(setIndex ?? Math.floor(Math.random() * SCENES.length));
  }, [setIndex]);

  const scene = index === null ? null : SCENES[index % SCENES.length]!;

  useLayoutEffect(() => {
    const root = sceneRef.current;
    if (!scene || !root) return;
    const stage = createStage(root);
    const show = (t: number, moving: boolean) => {
      scene.frame(t, stage);
      root.setAttribute("opacity", String(moving ? clamp(Math.min(t / FADE, (scene.duration - t) / FADE), 0, 1) : 1));
      const status = scene.status(t);
      if (statusRef.current && statusRef.current.textContent !== status) statusRef.current.textContent = status;
      dotRefs.current.forEach((dot, i) => {
        if (dot) dot.style.opacity = String(moving ? 0.2 + 0.8 * Math.max(0, Math.sin(t * 6 - i * 0.9)) : 0.6);
      });
    };

    // Read directly too: the state only lands after the first effect, and nothing should move before.
    if (freezeAt !== undefined || reduced || prefersReducedMotion()) {
      show(freezeAt ?? scene.still, false);
      return;
    }

    let elapsed = 0;
    let last: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      if (last === null) last = now;
      // Capped, so a hidden tab (no frames) resumes where it left off instead of jumping.
      elapsed += Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (elapsed >= scene.duration) {
        setIndexState((i) => ((i ?? 0) + 1) % SCENES.length);
        return;
      }
      show(elapsed, true);
      frame = nextFrame(tick);
    };
    show(0, true);
    frame = nextFrame(tick);
    return () => cancelFrame(frame);
  }, [scene, reduced, freezeAt]);

  return (
    <div
      aria-hidden="true"
      data-set={scene?.id}
      data-reduced={reduced ? "true" : undefined}
      className={cn("flex min-w-0 flex-col items-center gap-1.5 rounded-[14px] bg-[hsl(var(--cat-stage))] px-4 pb-3.5 pt-3", className)}
    >
      <svg viewBox="-30 22 360 228" className="block h-auto w-full max-w-[480px]" focusable="false">
        <g ref={sceneRef} key={scene?.id ?? "none"}>
          {scene ? (
            <>
              <ellipse cx="150" cy="226" rx="178" ry="7" style={fill("shadow")} />
              {scene.back(uid)}
              <CatShadow />
              <CatBody accessory={scene.accessory}>{scene.held?.(uid)}</CatBody>
              <CatArm />
              {scene.front?.(uid)}
              <CatHand>{scene.inHand?.(uid)}</CatHand>
              <CatPaw />
              {scene.over?.(uid)}
            </>
          ) : null}
        </g>
      </svg>
      <p className="m-0 flex min-h-[1.5em] items-center font-mono text-[12.5px] tracking-[0.02em] text-muted-foreground">
        <span ref={statusRef}>{scene ? scene.status(freezeAt ?? 0) : ""}</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            ref={(el) => {
              dotRefs.current[i] = el;
            }}
            className="w-[0.6em] text-center"
          >
            .
          </span>
        ))}
      </p>
    </div>
  );
}
