"use client";

import Link from "next/link";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ds";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";

interface Props {
  title: string;
  reason: string;
  retakeHref: string;
  backHref?: string;
  backLabel?: string;
  /** Replaces the no-cooldown line (null: no line at all). */
  note?: string | null;
  /** The retake button is secondary where the report itself is the expected outcome. */
  retakeVariant?: "default" | "secondary";
}

/** Not scored, or the report is still being written: one plain sentence, and a free retake. */
export function ReportUnscorable({ title, reason, retakeHref, backHref, backLabel, note, retakeVariant = "default" }: Props) {
  const { canInterview, interviewBlocked } = useCurrentUser();
  return (
    <Card title={title} className="max-w-[560px]">
      <p className="m-0 text-[14.5px] leading-[1.55]">{reason}</p>
      {note === null ? null : (
        <p className="m-0 mt-2 text-[13.5px] leading-[1.55] text-ink-3">{note ?? "There is no cooldown. Your retake is free."}</p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {canInterview ? (
          <Button asChild variant={retakeVariant}>
            <Link href={retakeHref}>Retake now</Link>
          </Button>
        ) : interviewBlocked ? (
          <InterviewAccessNote className="self-center" />
        ) : null}
        {backHref ? (
          <Button asChild variant="outline">
            <Link href={backHref}>{backLabel ?? "Back"}</Link>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
