import type { JdFitLevelGap } from "@/features/jobs";
import { Chip } from "@/components/ds";
import { cn } from "@/lib/utils/cn";
import { levelLabel } from "./library";

export const MATCH_TITLE = "How closely your resume, GitHub and coding profiles match this role's listing";

export interface MatchFit {
  score: number | null;
  levelGap: JdFitLevelGap;
  cap: number | null;
}

/** "72% match" as a Chip (ink-2 on surface-2). A capped stretch role reads "≤40% match" in the outline tone. */
export function MatchPill({ fit, className }: { fit: MatchFit; className?: string }) {
  if (fit.score === null) return null;
  const stretch = fit.levelGap === "stretch";
  const capped = stretch && fit.cap !== null && fit.score >= fit.cap;
  return (
    <span title={MATCH_TITLE} className={cn("flex-none", className)}>
      <Chip tone={stretch ? "outline" : "default"} className="tabular-nums">
        {capped ? "≤" : ""}
        {fit.score}% match
      </Chip>
    </span>
  );
}

/** "Stretch role · SDE 3" / "Below your level" / null. Never worded as eligibility. */
export function levelGapText(gap: JdFitLevelGap, jdLevel: string | null | undefined): string | null {
  if (gap === "stretch") return `Stretch role · ${levelLabel(jdLevel)}`;
  if (gap === "below") return "Below your level";
  return null;
}
