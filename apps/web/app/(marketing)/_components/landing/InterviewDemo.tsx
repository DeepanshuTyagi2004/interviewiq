"use client";

import { useEffect, useRef, useState } from "react";
import { Waveform } from "@/components/visualizations/Waveform";
import { useInterval } from "@/lib/hooks/useInterval";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { INTERVIEW_ANSWER, INTERVIEW_QUESTION, SIGNALS } from "./content";

const START_SECONDS = 14 * 60 + 7;
const TYPE_PAUSE_MS = 2600;

function formatClock(total: number): string {
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Nudges a base value a little each tick so the signal tiles feel live. */
function jitter(base: number, tick: number): number {
  return Math.max(5, Math.min(98, base + Math.round(Math.sin(tick * 0.9 + base) * 5)));
}

/**
 * "The interview" illustration: the AI interviewer's question, the candidate's answer typing out
 * live, a running round clock and four jittering signal tiles. Stands still under reduced motion.
 */
export function InterviewDemo() {
  const reduced = useReducedMotion();
  const [seconds, setSeconds] = useState(START_SECONDS);
  const [tick, setTick] = useState(0);
  const typedRef = useRef<HTMLSpanElement>(null);

  useInterval(
    () => {
      setSeconds((s) => s + 1);
      setTick((t) => t + 1);
    },
    reduced ? null : 1000,
  );

  // Type the answer character by character, pause, then start over. Written straight to the DOM
  // so the per-keystroke updates don't re-render the component.
  useEffect(() => {
    const el = typedRef.current;
    if (!el) return;
    if (reduced) {
      el.textContent = INTERVIEW_ANSWER;
      return;
    }
    let i = 0;
    let timer: number;
    const step = () => {
      i = i >= INTERVIEW_ANSWER.length ? 0 : i + 1;
      el.textContent = INTERVIEW_ANSWER.slice(0, i);
      const done = i >= INTERVIEW_ANSWER.length;
      timer = window.setTimeout(step, done ? TYPE_PAUSE_MS : 28 + Math.random() * 50);
    };
    step();
    return () => window.clearTimeout(timer);
  }, [reduced]);

  return (
    <div className="flex w-full max-w-[400px] flex-col items-center gap-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <span
          aria-hidden
          className="h-11 w-11 rounded-full shadow-[0_6px_20px_rgba(0,0,0,.15)]"
          style={{
            background:
              "radial-gradient(circle at 35% 30%, #fff, hsl(var(--faint)) 45%, hsl(var(--foreground)) 85%)",
          }}
        />
        <p className="m-0 text-[17px]">Round 2 · Problem Solving</p>
        <Waveform bars={34} height={22} animated={!reduced} className="text-foreground" />
      </div>

      {/* The transcript card is always dark, in both themes — hence the fixed colours. */}
      <div className="flex w-full flex-col gap-3 rounded-[22px] bg-inv p-5 text-white shadow-float">
        <div className="flex items-center gap-2 text-xs text-[#a1a1a6]">
          <span
            aria-hidden
            data-motion
            className="h-1.5 w-1.5 rounded-full bg-brand"
            style={{ animation: reduced ? undefined : "iq-breathe 1.4s ease-in-out infinite" }}
          />
          Interviewer · speaking
          <span className="ml-auto font-medium tabular-nums text-white">
            {formatClock(seconds)}
          </span>
        </div>
        <p className="m-0 text-[14.5px] leading-[1.5] text-[#f5f5f7]">{INTERVIEW_QUESTION}</p>
        <div aria-hidden className="h-px bg-[#2c2c2e]" />
        <p className="m-0 text-xs text-[#a1a1a6]">You</p>
        <p className="m-0 min-h-[42px] text-sm leading-[1.5] text-[#d2d2d7]">
          <span ref={typedRef} />
          <span
            aria-hidden
            data-motion
            className="ml-px inline-block h-[15px] w-[2px] bg-white align-[-3px]"
            style={{ animation: reduced ? undefined : "iq-blink 1s step-end infinite" }}
          />
        </p>
      </div>

      <dl className="m-0 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        {SIGNALS.map(([label, base]) => {
          const value = jitter(base, tick);
          return (
            <div key={label} className="rounded-2xl bg-card px-3 py-2.5 shadow-ring">
              <dt className="text-xs text-faint">{label}</dt>
              <dd className="m-0 mt-0.5 text-[19px] font-semibold tabular-nums">
                {label === "Fillers" ? String(Math.round(value / 3.5)) : (value / 10).toFixed(1)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
