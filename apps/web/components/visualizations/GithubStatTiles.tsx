import { StatRow, StatTile } from "@/components/patterns";
import type { GithubFragment } from "@/features/profile";

/** GitHub counts as a KPI row. Descriptive only — never a score or comparison. */
export function GithubStatTiles({ github, className }: { github: GithubFragment; className?: string }) {
  const totalStars = github.topRepos.reduce((sum, r) => sum + r.stars, 0);

  return (
    <StatRow className={className}>
      <StatTile value={github.publicRepos.toLocaleString()} label="Public repos" />
      <StatTile value={github.externalPRs.toLocaleString()} label="External PRs" />
      <StatTile value={totalStars.toLocaleString()} label="Stars on top repos" />
      <StatTile value={String(github.joinedYear)} label="On GitHub since" />
    </StatRow>
  );
}
