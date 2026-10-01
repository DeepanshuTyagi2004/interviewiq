import type { LeetCodeFragment } from "@/features/profile";
import { ShareBar } from "./ShareBar";

/**
 * Difficulty is ordered, so it reads as one sequential ink ramp (Easy lightest → Hard strongest)
 * rather than traffic-light colours that would imply good/bad. Counts only.
 */
const RAMP = {
  easy: "hsl(var(--faint-2))",
  medium: "hsl(var(--muted-foreground))",
  hard: "hsl(var(--foreground))",
};

export function LeetCodeDifficulty({ solved }: { solved?: LeetCodeFragment["solved"] }) {
  const total = solved ? solved.easy + solved.medium + solved.hard : 0;
  if (!solved || total === 0) {
    return <p className="m-0 text-sm text-muted-foreground">No LeetCode data yet.</p>;
  }

  const shares = [
    { name: "Easy", value: solved.easy, color: RAMP.easy },
    { name: "Medium", value: solved.medium, color: RAMP.medium },
    { name: "Hard", value: solved.hard, color: RAMP.hard },
  ].filter((s) => s.value > 0);

  return (
    <ShareBar
      label="Problems solved by difficulty"
      shares={shares}
      formatValue={(s) => s.value.toLocaleString()}
    />
  );
}
