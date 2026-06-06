import { GitPullRequest, FolderGit2, CalendarDays, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { GithubFragment } from "@/features/profile";

interface Tile {
  label: string;
  value: string;
  icon: typeof Star;
}

export function GithubStatTiles({ github }: { github: GithubFragment }) {
  const totalStars = github.topRepos.reduce((sum, r) => sum + r.stars, 0);
  const tiles: Tile[] = [
    { label: "Public repos", value: github.publicRepos.toLocaleString(), icon: FolderGit2 },
    { label: "External PRs", value: github.externalPRs.toLocaleString(), icon: GitPullRequest },
    { label: "Stars on top repos", value: totalStars.toLocaleString(), icon: Star },
    { label: "On GitHub since", value: String(github.joinedYear), icon: CalendarDays },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="flex flex-col gap-1 p-4">
            <t.icon className="h-4 w-4 text-muted-foreground" aria-hidden={true} />
            <span className="font-mono text-2xl font-semibold tabular-nums">
              {t.value}
            </span>
            <span className="text-xs text-muted-foreground">{t.label}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
