import { StatRow, StatTile } from "@/components/patterns";
import type { LeetCodeFragment } from "@/features/profile";

/** Title-case a language token for display (e.g. "python3" → "Python3"). */
function prettyLang(lang: string): string {
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

/**
 * Surfaces the contest (call 2) and recent-activity (call 3) LeetCode data as KPI tiles.
 * Descriptive only — the contest rating is LeetCode's own stat, never an InterviewIQ score.
 * The rating gets a restrained accent (Geist chart-1) to draw the eye; everything else is mono.
 */
export function LeetCodeStatTiles({ leetcode }: { leetcode: LeetCodeFragment }) {
  const solved = leetcode.solved?.total ?? 0;
  const contest = leetcode.contest;
  const last30Days = leetcode.recentActivity?.last30Days ?? 0;
  const preferredLanguage = leetcode.recentActivity?.preferredLanguage;

  return (
    <div className="space-y-2">
      <StatRow>
        <StatTile value={solved.toLocaleString()} label="Problems solved" />
        <StatTile
          value={
            contest ? (
              <span style={{ color: "hsl(var(--chart-1))" }}>
                {contest.rating.toLocaleString()}
              </span>
            ) : (
              "—"
            )
          }
          label="Contest rating"
        />
        <StatTile value={contest ? contest.attended.toLocaleString() : "—"} label="Contests" />
        <StatTile value={last30Days.toLocaleString()} label="Solved · last 30d" />
      </StatRow>

      {contest || preferredLanguage ? (
        <p className="text-xs text-muted-foreground">
          {contest ? (
            <>
              Top{" "}
              <span className="font-mono tabular-nums text-foreground">{contest.topPercent}%</span>{" "}
              of {contest.totalParticipants.toLocaleString()} contestants
            </>
          ) : null}
          {contest && preferredLanguage ? " · " : null}
          {preferredLanguage ? (
            <>
              Recent submissions mostly in{" "}
              <span className="text-foreground">{prettyLang(preferredLanguage)}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
