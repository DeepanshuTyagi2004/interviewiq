"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiFetchError } from "@/lib/api-client/errors";
import { formatScore, useCreateDispute, type ReportDispute, type RoundReport } from "@/features/report";

export const DISPUTE_MAX_CHARS = 500;
export const MAX_DISPUTES = 3;

const ERROR_COPY: Record<string, string> = {
  dispute_window_closed: "The 14-day window for questioning this report has closed.",
  dispute_exists: "This part of the report has already been questioned.",
  dispute_limit: "You've used all 3 re-checks for this report.",
  invalid_dispute: "That part of the report can't be questioned. Refresh the page and try again.",
};

/** Plain-sentence message for a failed dispute request. */
export function disputeErrorMessage(error: unknown): string {
  if (error instanceof ApiFetchError && error.code && ERROR_COPY[error.code]) return ERROR_COPY[error.code];
  return "We couldn't send that. Please try again.";
}

export function findDispute(report: Pick<RoundReport, "disputes">, type: "question" | "area", id: string): ReportDispute | undefined {
  return report.disputes?.find((d) => d.target?.type === type && d.target?.id === id);
}

/** Dialog: why do you think this score is wrong? (max 500 characters). Mounted only while open. */
export function DisputeDialog({
  sessionId,
  targetType,
  targetId,
  targetLabel,
  open,
  onOpenChange,
  onSubmitted,
}: {
  sessionId: string;
  targetType: "question" | "area";
  targetId: string;
  targetLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useCreateDispute(sessionId);
  const trimmed = reason.trim();
  const tooLong = reason.length > DISPUTE_MAX_CHARS;
  const canSubmit = trimmed.length > 0 && !tooLong && !mutation.isPending;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    mutation.mutate(
      { target: { type: targetType, id: targetId }, reason: trimmed },
      {
        onSuccess: () => {
          onSubmitted?.();
          onOpenChange(false);
        },
        onError: (e) => setError(disputeErrorMessage(e)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!mutation.isPending ? onOpenChange(next) : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Question this score</DialogTitle>
          <DialogDescription>
            {targetLabel}. Tell us what you think was missed. A re-check can keep or raise this score, never lower it.
          </DialogDescription>
        </DialogHeader>
        <div>
          <label htmlFor={`dispute-${targetType}-${targetId}`} className="sr-only">
            Your reason
          </label>
          <Textarea
            id={`dispute-${targetType}-${targetId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={5}
            placeholder="What did the grader miss?"
            aria-invalid={tooLong}
          />
          <p className={`m-0 mt-1 text-right font-mono text-[11.5px] tabular-nums ${tooLong ? "text-destructive" : "text-ink-3"}`}>
            {reason.length}/{DISPUTE_MAX_CHARS}
          </p>
          {tooLong ? (
            <p role="alert" className="m-0 mt-1 text-[13px] text-destructive">
              Keep your reason to {DISPUTE_MAX_CHARS} characters or fewer.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="m-0 mt-1 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {mutation.isPending ? "Sending…" : "Send for re-check"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Button + inline status for one question or area: pending / upheld / revised, or nothing when it can't be disputed. */
export function DisputeControl({
  report,
  sessionId,
  targetType,
  targetId,
  targetLabel,
}: {
  report: RoundReport;
  sessionId: string;
  targetType: "question" | "area";
  targetId: string;
  targetLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const existing = findDispute(report, targetType, targetId);
  const atLimit = (report.disputes?.length ?? 0) >= MAX_DISPUTES;
  const [seenPending, setSeenPending] = useState(false);
  // The server says a re-check is running (`recheckPending`); it is this one when the target matches, or when this control
  // sent it. Between sending and the next report fetch, the one just sent shows as running; once the server has reported it
  // running and then stopped without a decision (the re-check failed), the button comes back.
  const pending = report.recheckPending === true;
  const target = report.recheckTarget ?? null;
  useEffect(() => {
    if (submitted && pending) setSeenPending(true);
  }, [submitted, pending]);
  const awaitingServer = submitted && !seenPending && !pending;
  const thisOne = pending ? (target ? target.type === targetType && target.id === targetId : submitted) : awaitingServer;

  let status: React.ReactNode = null;
  if (existing?.decision === "upheld") {
    status = (
      <>
        Re-checked: score unchanged.{existing.explanation ? ` ${existing.explanation}` : ""}
      </>
    );
  } else if (existing?.decision === "revised") {
    const scores =
      existing.oldScore != null && existing.newScore != null ? ` ${formatScore(existing.oldScore)} → ${formatScore(existing.newScore)}.` : "";
    status = (
      <>
        Re-checked: score revised.{scores}
        {existing.explanation ? ` ${existing.explanation}` : ""}
      </>
    );
  } else if (thisOne) {
    status = <>Re-checking…</>;
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {status ? (
        <p role="status" className="m-0 flex max-w-[68ch] gap-2 text-[13px] leading-[1.55] text-ink-2">
          <span aria-hidden className={`mt-[7px] h-1.5 w-1.5 flex-none rounded-full ${existing ? "bg-ink" : "bg-ink iq-breathe"}`} />
          <span>{status}</span>
        </p>
      ) : !atLimit && !pending && !awaitingServer ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} className="-ml-3.5 h-7 px-3.5 text-[12.5px] text-ink-3 hover:text-ink">
          Question this score<span className="sr-only"> for {targetLabel}</span>
        </Button>
      ) : null}
      {open ? (
        <DisputeDialog
          sessionId={sessionId}
          targetType={targetType}
          targetId={targetId}
          targetLabel={targetLabel}
          open={open}
          onOpenChange={setOpen}
          onSubmitted={() => {
            setSubmitted(true);
            setSeenPending(false);
          }}
        />
      ) : null}
    </div>
  );
}
