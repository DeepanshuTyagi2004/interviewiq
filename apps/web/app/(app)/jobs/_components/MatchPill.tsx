import type { JdFitLevelGap } from "@/features/jobs";
import { cn } from "@/lib/utils/cn";
import { levelLabel } from "./library";

export const MATCH_TITLE = "How closely your resume, GitHub and coding profiles match this role's listing";

export interface MatchFit {
  score: number | null;
  levelGap: JdFitLevelGap;
  cap: number | null;
}

/** "72% match", a neutral pill (orange stays the single accent). A capped stretch role reads "≤40% match", dimmed. */
export function MatchPill({ fit, className }: { fit: MatchFit; className?: string }) {
  if (fit.score === null) return null;
  const stretch = fit.levelGap === "stretch";
  const capped = stretch && fit.cap !== null && fit.score >= fit.cap;
  return (
    <span
      title={MATCH_TITLE}
      className={cn(
        "inline-flex h-6 flex-none items-center whitespace-nowrap rounded-full border border-line-3 px-2.5 font-mono text-[11.5px] leading-none tabular-nums",
        stretch ? "text-faint" : "text-foreground",
        className,
      )}
    >
      {capped ? "≤" : ""}
      {fit.score}% match
    </span>
  );
}

/** "Stretch role · SDE 3" / "Below your level" / null. Never worded as eligibility. */
export function levelGapText(gap: JdFitLevelGap, jdLevel: string | null | undefined): string | null {
  if (gap === "stretch") return `Stretch role · ${levelLabel(jdLevel)}`;
  if (gap === "below") return "Below your level";
  return null;
}
