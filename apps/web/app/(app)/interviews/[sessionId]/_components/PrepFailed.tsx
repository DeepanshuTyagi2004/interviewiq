"use client";

import { Card } from "@/components/ds";
import { BarsMascot } from "@/components/mascot/BarsMascot";
import type { InterviewSession } from "@/features/interview";
import { RetryPrepButton } from "../../_components/RetryPrepButton";

/** A failed prep: what happened in plain words, a retry, and the stable code tucked into details. */
export function PrepFailed({ session }: { session: InterviewSession }) {
  return (
    <Card tone="stone" title="Preparation">
      <div className="flex flex-col items-start gap-3">
        <div className="pt-3">
          <BarsMascot mood="oops" form="trio" size={84} />
        </div>
        <p role="alert" className="m-0 font-display text-[20px] font-normal leading-snug tracking-[-0.02em] text-destructive">
          We couldn&apos;t prepare this interview.
        </p>
        <p className="m-0 text-[14px] leading-[1.55] text-ink-2">
          Nothing is lost: retry and we&apos;ll prepare it again. Your slot stays booked.
        </p>
        <RetryPrepButton session={session} />
        {session.prep.errorCode ? (
          <details className="text-[13px] text-ink-3">
            <summary className="cursor-pointer select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink">Details</summary>
            <p className="m-0 mt-1.5">
              Error code <span className="font-mono text-ink">{session.prep.errorCode}</span>
            </p>
          </details>
        ) : null}
      </div>
    </Card>
  );
}
