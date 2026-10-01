import type { GithubLanguage } from "@/features/profile";
import { ShareBar } from "./ShareBar";
import { foldShares, formatPct } from "./shares";

/**
 * GitHub languages by share of code (bytes), as a stacked bar + legend. The five largest keep
 * their own colour; the long tail folds into "Other". Descriptive only.
 */
export function LanguageDistribution({ languages }: { languages: GithubLanguage[] }) {
  const shares = foldShares(languages, (l) => l.name, (l) => l.pct);
  if (!shares.length) {
    return <p className="m-0 text-sm text-muted-foreground">No language data yet.</p>;
  }

  return (
    <ShareBar
      label="Languages by share of code"
      shares={shares}
      formatValue={(s, total) => formatPct(total > 0 ? (s.value / total) * 100 : 0)}
    />
  );
}
