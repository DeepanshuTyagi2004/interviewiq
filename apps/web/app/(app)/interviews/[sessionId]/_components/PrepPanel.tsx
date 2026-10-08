"use client";

import { StatusDot, padCount, type DotState } from "@/components/hud";
import { cn } from "@/lib/utils/cn";
import { PREP_STEP_LABELS } from "@/lib/constants/interview";
import type { InterviewSession, PrepStep } from "@/features/interview";
import { PrepAnimation } from "./prep-animation/PrepAnimation";

export type FriendlyStepState = "done" | "active" | "pending" | "failed";

export interface FriendlyStep {
  label: string;
  state: FriendlyStepState;
  elapsedMs: number | null;
}

/**
 * The run's stages folded into the candidate-facing steps (spec §9.1). Labels never name topics,
 * problems or difficulty. With no readable run yet (just booked, or the AI service is slow to
 * answer) the first step is shown as starting.
 */
export function friendlySteps(steps: PrepStep[]): FriendlyStep[] {
  const byId = new Map(steps.map((s) => [s.id as string, s]));
  const out = PREP_STEP_LABELS.map(({ ids, label }) => {
    const own = ids.map((id) => byId.get(id)).filter((s): s is PrepStep => !!s);
    const states = own.map((s) => s.state);
    const state: FriendlyStepState = states.includes("failed")
      ? "failed"
      : states.includes("active")
        ? "active"
        : own.length > 0 && states.every((s) => s === "done")
          ? "done"
          : "pending";
    const elapsed = own.reduce((sum, s) => sum + (s.elapsedMs ?? 0), 0);
    return { label, state, elapsedMs: own.some((s) => s.elapsedMs !== null) ? elapsed : null };
  });
  if (!out.some((s) => s.state !== "pending")) out[0] = { ...out[0]!, state: "active" };
  return out;
}

function seconds(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? "<1s" : `${Math.round(ms / 1000)}s`;
}

const DOT: Record<FriendlyStepState, DotState> = { done: "active", active: "live", pending: "idle", failed: "error" };
const STATE_TEXT: Record<FriendlyStepState, string> = { done: "Done", active: "In progress", pending: "Not yet", failed: "Needs attention" };

/** While the blueprint is being prepared: a looping mascot above live, friendly progress steps. */
export function PrepPanel({ session }: { session: InterviewSession }) {
  const steps = friendlySteps(session.prep.steps);
  return (
    <section aria-labelledby="prep-progress" className="flex min-w-0 flex-col gap-4 rounded-[14px] bg-panel p-4 sm:p-5">
      <h2 id="prep-progress" className="iq-eyebrow m-0 font-normal">
        Preparing your interviewer
      </h2>
      <PrepAnimation className="w-full" />
      <ol className="iq-float m-0 flex list-none flex-col px-4 py-1.5" aria-live="polite">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center gap-3.5 py-2.5">
            <span className="flex h-[22px] w-[11px] flex-none items-center justify-center">
              {step.state === "done" ? (
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground" />
              ) : (
                <StatusDot state={DOT[step.state]} />
              )}
            </span>
            <span aria-hidden className="font-mono text-[11px] tabular-nums text-faint">
              {padCount(i + 1)}
            </span>
            <span className={cn("min-w-0 flex-1 text-[14px]", step.state === "pending" ? "text-faint" : "text-foreground")}>
              {step.label}
            </span>
            {step.state === "done" && seconds(step.elapsedMs) ? (
              <span className="font-mono text-[11.5px] tabular-nums text-faint">{seconds(step.elapsedMs)}</span>
            ) : null}
            <span className="sr-only">{STATE_TEXT[step.state]}</span>
          </li>
        ))}
      </ol>
      <p className="m-0 text-[13px] leading-[1.5] text-muted-foreground">
        This usually takes a few minutes. You can leave this page; we&apos;ll keep going.
      </p>
    </section>
  );
}
