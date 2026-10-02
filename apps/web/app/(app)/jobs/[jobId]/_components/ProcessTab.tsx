import Link from "next/link";
import { EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import type { JdDetail } from "@/features/jobs";
import { confidenceWord } from "./insights";
import { RoundCard } from "./RoundCard";
import { bookHref } from "./rounds";

/** The suggested process as round cards, or an honest empty state when there's no brief yet. */
export function ProcessTab({ jd }: { jd: JdDetail }) {
  const rounds = jd.interviewProcess?.rounds ?? [];
  const confidence = confidenceWord(jd.dataConfidence ?? jd.interviewProcess?.data_confidence);

  if (rounds.length === 0) {
    return (
      <EmptyState
        title="No interview data yet"
        hint="This role's interview process hasn't been researched yet, or there wasn't enough shared data to build one. You can still book a practice round for it."
        action={
          <Button asChild variant="strong" size="sm">
            <Link href={bookHref(jd.id, null)}>Book a round</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <ol aria-label="Interview rounds" className="m-0 flex list-none flex-col gap-2.5 p-0">
        {rounds.map((round, i) => (
          <RoundCard key={`${round.round_number ?? i}-${round.type ?? ""}`} round={round} index={i} jdId={jd.id} />
        ))}
      </ol>

      <div className="mt-4 rounded-[14px] bg-panel px-5 py-[18px]">
        <p className="m-0 text-sm">Suggested process</p>
        <p className="m-0 mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">
          {confidence === "low" ? "Built from limited shared data, so treat it as a rough guide. " : "Built from interview experiences candidates share. "}
          Customising rounds isn&apos;t available yet. When it is, a customised loop will be standalone practice: fully
          analysed, but not counted towards readiness.
        </p>
      </div>
    </>
  );
}
