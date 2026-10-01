import { StatRow, StatTile } from "@/components/patterns";
import type { LeetCodeFragment } from "@/features/profile";

/** Title-case a language token for display (e.g. "python3" → "Python3"). */
export function prettyLang(lang: string): string {
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

/**
 * Surfaces the contest (call 2) and recent-activity (call 3) LeetCode data as KPI tiles.
 * Descriptive only: the contest rating is LeetCode's own number, shown as a plain count like the
 * rest — never an InterviewIQ score, and never framed as a comparison with other people.
 */
export function LeetCodeStatTiles({ leetcode, className }: { leetcode: LeetCodeFragment; className?: string }) {
  const solved = leetcode.solved?.total ?? 0;
  const contest = leetcode.contest;
  const last30Days = leetcode.recentActivity?.last30Days ?? 0;

  return (
    <StatRow className={className}>
      <StatTile value={solved.toLocaleString()} label="Problems solved" />
      <StatTile value={contest ? contest.rating.toLocaleString() : "—"} label="Contest rating" />
      <StatTile value={contest ? contest.attended.toLocaleString() : "—"} label="Contests" />
      <StatTile value={last30Days.toLocaleString()} label="Solved · last 30d" />
    </StatRow>
  );
}
