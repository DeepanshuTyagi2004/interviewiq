import { StatRow, StatTile } from "@/components/patterns";
import type { GithubFragment } from "@/features/profile";

export function GithubStatTiles({ github }: { github: GithubFragment }) {
  const totalStars = github.topRepos.reduce((sum, r) => sum + r.stars, 0);

  return (
    <StatRow>
      <StatTile
        value={github.publicRepos.toLocaleString()}
        label="Public repos"
      />
      <StatTile
        value={github.externalPRs.toLocaleString()}
        label="External PRs"
      />
      <StatTile value={totalStars.toLocaleString()} label="Stars on top repos" />
      <StatTile value={String(github.joinedYear)} label="On GitHub since" />
    </StatRow>
  );
}
