import { HudCard, Readout } from "@/components/hud";
import { cn } from "@/lib/utils/cn";

/**
 * The design's score and rank tiles. The scoring contract doesn't exist yet (formulas are an open
 * product decision), so every value is an honest "—" with a note on what it will be based on. No
 * status dot or "pending" label: nothing is being computed, so there is no state to show. There is
 * no profile score — sources shape the summary and the interviewer, never a number.
 */
function NotYet() {
  return (
    <>
      <span aria-hidden className="text-faint">
        —
      </span>
      <span className="sr-only">Not available yet</span>
    </>
  );
}

const BODY = "px-[calc(18*var(--u))] py-[calc(24*var(--u))] sm:px-[calc(26*var(--u))]";

/** Interview score: from interviews taken, once scoring ships. */
export function InterviewScoreCard({ className }: { className?: string }) {
  return (
    <HudCard aria-label="Interview score" glow="r" className={className} bodyClassName={BODY}>
      <Readout label="Interview score" value={<NotYet />} note="From your interviews · coming soon" />
    </HudCard>
  );
}

/** College and global rank side by side, split by a hairline. Boards need interview scores first. */
export function RanksCard({ className }: { className?: string }) {
  return (
    <HudCard aria-label="Ranks" glow="tl" className={className} bodyClassName="grid grid-cols-2">
      {["College rank", "Global rank"].map((label, i) => (
        <div key={label} className={cn("min-w-0", BODY, i > 0 && "border-l border-line")}>
          <Readout label={label} value={<NotYet />} note="Coming soon" />
        </div>
      ))}
    </HudCard>
  );
}
