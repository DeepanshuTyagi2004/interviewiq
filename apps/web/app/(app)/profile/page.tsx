"use client";

import Link from "next/link";
import { useProfile } from "@/features/profile";
import { ROUTES } from "@/lib/constants/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AtAGlance } from "./_components/AtAGlance";
import { GithubStatTiles } from "@/components/visualizations/GithubStatTiles";
import { LanguageDistribution } from "@/components/visualizations/LanguageDistribution";
import { ContributionHeatmap } from "@/components/visualizations/ContributionHeatmap";
import { LeetCodeDifficulty } from "@/components/visualizations/LeetCodeDifficulty";
import { LeetCodeTopics } from "@/components/visualizations/LeetCodeTopics";

export default function ProfilePage() {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex-1 p-6">
        <p role="alert" className="text-sm text-destructive">
          Could not load your profile. Please refresh the page.
        </p>
      </div>
    );
  }

  const github = data.fragments.github;
  const leetcode = data.fragments.leetcode;
  const githubConnected = data.sources.some(
    (s) => s.source === "GITHUB" && s.connected,
  );

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {data.user.name ?? "Your profile"}
          </h2>
          {data.user.headline ? (
            <p className="text-sm text-muted-foreground">{data.user.headline}</p>
          ) : null}
        </div>
        <Button asChild variant="outline">
          <Link href={ROUTES.connections}>Manage connections</Link>
        </Button>
      </div>

      <AtAGlance
        atAGlance={data.atAGlance}
        notable={data.notable}
        mostUsedSkills={data.mostUsedSkills}
      />

      {githubConnected && github ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">GitHub</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <GithubStatTiles github={github} />
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">Languages</h3>
                <LanguageDistribution languages={github.languages} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Contributions</h3>
                <ContributionHeatmap
                  weeks={github.contributions.weeks}
                  totalLastYear={github.contributions.lastYear}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">GitHub</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Connect GitHub to see your languages, repos and contributions.
            </p>
            <Button asChild>
              <Link href={ROUTES.connections}>Connect</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LeetCode</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium">By difficulty</h3>
            <LeetCodeDifficulty solved={leetcode?.solved} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">By topic</h3>
            <LeetCodeTopics byTopic={leetcode?.byTopic} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
