"use client";

import Link from "next/link";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { Card, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import type { JdDetail } from "@/features/jobs";
import { confidenceWord } from "./insights";
import { ProcessFlow } from "./ProcessFlow";
import { RoundCard } from "./RoundCard";
import { bookHref, isAdminVerifiedProcess } from "./rounds";

/** The suggested process as a timeline of round cards, or an honest empty state when there's no brief yet. */
export function ProcessTab({ jd }: { jd: JdDetail }) {
  const { canInterview, interviewBlocked } = useCurrentUser();
  const rounds = jd.interviewProcess?.rounds ?? [];
  const confidence = confidenceWord(jd.dataConfidence ?? jd.interviewProcess?.data_confidence);
  const verified = isAdminVerifiedProcess(jd.interviewProcess);

  if (rounds.length === 0) {
    return (
      <Card as="div" tone="surface">
        <EmptyState
          title="No interview data yet"
          hint="This role's interview process hasn't been researched yet, or there wasn't enough shared data to build one. You can still book a practice round for it."
        >
          {canInterview ? (
            <Button asChild size="sm">
              <Link href={bookHref(jd.id, null)}>Book a round</Link>
            </Button>
          ) : interviewBlocked ? (
            <InterviewAccessNote />
          ) : null}
        </EmptyState>
      </Card>
    );
  }

  // Interview rounds are numbered; info steps (online tests, take-homes) are shown but not counted.
  let interviewNo = 0;
  return (
    <>
      {interviewBlocked ? <InterviewAccessNote className="mb-3" /> : null}
      <ProcessFlow jd={jd} />

      <h2 className="m-0 mb-3.5 mt-10 font-display text-[18px] font-medium tracking-[-0.01em]">Round details</h2>
      <ol aria-label="Interview rounds" className="m-0 flex list-none flex-col gap-3 p-0">
        {rounds.map((round, i) => (
          <RoundCard
            key={round.id ?? `${round.round_number ?? i}-${round.type ?? ""}`}
            round={round}
            index={i}
            jdId={jd.id}
            number={round.kind === "info" ? undefined : ++interviewNo}
            practiceTemplate={jd.practiceTemplate}
          />
        ))}
      </ol>

      {/* An admin-verified process already says so in the header; the other kinds still need their caveat. */}
      {verified && !jd.practiceTemplate ? null : (
        <Card as="div" tone="stone" className="mt-4">
          <p className="m-0 text-[15px] font-medium">{jd.practiceTemplate ? "Practice template" : "Suggested process"}</p>
          <p className="m-0 mt-1 text-[13px] leading-[1.55] text-ink-2">
            {jd.practiceTemplate ? "Simulated practice rounds, not verified company interview research." : confidence === "low" ? "Built from limited shared data, so treat it as a rough guide." : "Built from interview experiences candidates share."}
          </p>
        </Card>
      )}
    </>
  );
}
