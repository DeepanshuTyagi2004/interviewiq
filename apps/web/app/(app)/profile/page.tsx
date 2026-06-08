"use client";

import Link from "next/link";
import { useProfile } from "@/features/profile";
import { ROUTES } from "@/lib/constants/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PageHeader,
  Section,
  SectionLabel,
  ProfileSkeleton,
  EmptyState,
} from "@/components/patterns";
import { AtAGlance } from "./_components/AtAGlance";
import { GithubStatTiles } from "@/components/visualizations/GithubStatTiles";
import { LanguageDistribution } from "@/components/visualizations/LanguageDistribution";
import { ContributionHeatmap } from "@/components/visualizations/ContributionHeatmap";
import { LeetCodeDifficulty } from "@/components/visualizations/LeetCodeDifficulty";
import { LeetCodeTopics } from "@/components/visualizations/LeetCodeTopics";
import { LeetCodeStatTiles } from "@/components/visualizations/LeetCodeStatTiles";

export default function ProfilePage() {
  const { data, isLoading, isError } = useProfile();

  if (isLoading) {
    return <ProfileSkeleton />;
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
    <div className="flex-1 space-y-8 p-6">
      <PageHeader
        title={data.user.name ?? "Your profile"}
        description={data.user.headline ?? undefined}
        actions={
          <Button asChild variant="outline">
            <Link href={ROUTES.connections}>Manage connections</Link>
          </Button>
        }
      />

      <AtAGlance
        atAGlance={data.atAGlance}
        notable={data.notable}
        mostUsedSkills={data.mostUsedSkills}
      />

      <Section title="GitHub">
        {githubConnected && github ? (
          <div className="space-y-6">
            <GithubStatTiles github={github} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardContent className="space-y-3 p-6">
                  <SectionLabel>Languages</SectionLabel>
                  <LanguageDistribution languages={github.languages} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-3 p-6">
                  <SectionLabel>Contributions</SectionLabel>
                  <ContributionHeatmap
                    weeks={github.contributions.weeks}
                    totalLastYear={github.contributions.lastYear}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <EmptyState
            title="GitHub not connected"
            hint="Connect GitHub to see your languages, repos and contributions."
            action={
              <Button asChild>
                <Link href={ROUTES.connections}>Connect</Link>
              </Button>
            }
          />
        )}
      </Section>

      <Section title="LeetCode">
        <div className="space-y-6">
          {leetcode ? <LeetCodeStatTiles leetcode={leetcode} /> : null}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardContent className="space-y-3 p-6">
                <SectionLabel>By difficulty</SectionLabel>
                <LeetCodeDifficulty solved={leetcode?.solved} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-3 p-6">
                <SectionLabel>By topic</SectionLabel>
                <LeetCodeTopics byTopic={leetcode?.byTopic} />
              </CardContent>
            </Card>
          </div>
        </div>
      </Section>
    </div>
  );
}
