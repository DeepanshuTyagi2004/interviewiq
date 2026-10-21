"use client";

import { Card, StatusDot, type DotState } from "@/components/ds";
import { BarsMascot } from "@/components/mascot/BarsMascot";
import { cn } from "@/lib/utils/cn";
import { PREP_STEP_LABELS } from "@/lib/constants/interview";
import type { InterviewSession, PrepStep } from "@/features/interview";

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

/** The one spot the prep screen's mascot lives in: the bars, morphing Trio, Hopper, Jelly, Bloom and back. */
function PrepMascot() {
  return (
    <div className="flex justify-center pb-2 pt-8">
      <BarsMascot mood="idle" size={140} />
    </div>
  );
}

/** While the blueprint is being prepared: the bars mascot above live, friendly progress steps. */
export function PrepPanel({ session }: { session: InterviewSession }) {
  const steps = friendlySteps(session.prep.steps);
  return (
    <Card tone="stone" title="Preparing your interviewer" titleAs="h2" className="flex-1">
      <PrepMascot />
      <ol className="m-0 mt-4 flex list-none flex-col p-0" aria-live="polite">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3.5 border-t border-line py-3 first:border-t-0">
            <span className="flex h-[22px] w-[11px] flex-none items-center justify-center">
              {step.state === "done" ? (
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ink" />
              ) : (
                <StatusDot state={DOT[step.state]} />
              )}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 text-[14px]",
                step.state === "active" || step.state === "failed" ? "font-medium text-ink" : step.state === "done" ? "text-ink-2" : "text-ink-3",
              )}
            >
              {step.label}
            </span>
            {step.state === "done" && seconds(step.elapsedMs) ? (
              <span className="text-[12px] tabular-nums text-ink-3">{seconds(step.elapsedMs)}</span>
            ) : null}
            <span className="sr-only">{STATE_TEXT[step.state]}</span>
          </li>
        ))}
      </ol>
      <p className="m-0 mt-4 text-[13px] leading-[1.5] text-ink-3">
        This usually takes a few minutes. You can leave this page; we&apos;ll keep going.
      </p>
    </Card>
  );
}
