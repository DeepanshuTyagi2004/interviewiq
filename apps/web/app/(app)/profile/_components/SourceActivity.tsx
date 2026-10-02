"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ProfileResponse } from "@/features/profile";
import { ROUTES } from "@/lib/constants/shared";
import { PROFILE_SYNC_STATUS } from "@/lib/constants/profile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContributionHeatmap } from "@/components/visualizations/ContributionHeatmap";
import { GithubStatTiles } from "@/components/visualizations/GithubStatTiles";
import { LanguageDistribution } from "@/components/visualizations/LanguageDistribution";
import { LeetCodeDifficulty } from "@/components/visualizations/LeetCodeDifficulty";
import { LeetCodeStatTiles, prettyLang } from "@/components/visualizations/LeetCodeStatTiles";
import { LeetCodeTopics } from "@/components/visualizations/LeetCodeTopics";
import { CardEmpty, ProfileCard } from "./ProfileCard";

/** Stat rows sit flush under the card header, divided from the charts by one hairline. */
const FLUSH_STATS = "rounded-none border-0 border-b border-line";

type ActivitySource = "github" | "leetcode";
const LABEL: Record<ActivitySource, string> = { github: "GitHub", leetcode: "LeetCode" };

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="iq-eyebrow m-0">{label}</p>
      {children}
    </div>
  );
}

/** GitHub languages, repos and a year of contributions — counts and shares only. */
function GithubBody({ profile }: { profile: ProfileResponse }) {
  const github = profile.fragments.github;
  if (!github) {
    return (
      <CardEmpty
        title="Importing your GitHub data"
        hint="Your languages, repos and contributions appear here once the first import finishes."
      />
    );
  }
  return (
    <>
      <GithubStatTiles github={github} className={FLUSH_STATS} />
      <div className="flex flex-col gap-7 px-4 py-5 sm:px-5">
        <Block label="Languages">
          <LanguageDistribution languages={github.languages} />
        </Block>
        <Block label="Contributions">
          <ContributionHeatmap weeks={github.contributions.weeks} totalLastYear={github.contributions.lastYear} />
        </Block>
      </div>
    </>
  );
}

/** LeetCode solved counts by difficulty and topic, plus LeetCode's own contest numbers. */
function LeetCodeBody({ profile }: { profile: ProfileResponse }) {
  const leetcode = profile.fragments.leetcode;
  if (!leetcode) {
    const source = profile.sources.find((s) => s.source === "LEETCODE");
    const syncing = source?.status === PROFILE_SYNC_STATUS.syncing;
    return (
      <CardEmpty
        title={syncing ? "Importing your LeetCode data" : "No LeetCode data yet"}
        hint="Solved problems by difficulty and topic appear here once the import finishes."
      />
    );
  }
  const preferred = leetcode.recentActivity?.preferredLanguage;
  return (
    <>
      <LeetCodeStatTiles leetcode={leetcode} className={FLUSH_STATS} />
      <div className="flex flex-col gap-7 px-4 py-5 sm:px-5">
        {preferred || leetcode.partial ? (
          <p className="m-0 -mb-2 text-[13px] text-muted-foreground">
            {preferred ? (
              <>
                Recent submissions mostly in <span className="text-foreground">{prettyLang(preferred)}</span>.
              </>
            ) : null}
            {leetcode.partial ? " Some LeetCode data couldn’t be imported, so a few numbers may be missing." : null}
          </p>
        ) : null}
        <Block label="By difficulty">
          <LeetCodeDifficulty solved={leetcode.solved} />
        </Block>
        <Block label="By topic">
          <LeetCodeTopics byTopic={leetcode.byTopic} />
        </Block>
      </div>
    </>
  );
}

function handleOf(profile: ProfileResponse, source: ActivitySource): string | undefined {
  const handle = source === "github" ? profile.fragments.github?.login : profile.fragments.leetcode?.username;
  return handle ? `@${handle}` : undefined;
}

function ConnectLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={ROUTES.connections}
      className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
    </Link>
  );
}

/**
 * What the connected accounts show, in one card: GitHub and LeetCode behind a switch when both are
 * connected, one of them when only one is, and a single slim prompt when neither is.
 */
export function ActivityCard({ profile, className }: { profile: ProfileResponse; className?: string }) {
  const connected = (["github", "leetcode"] as const).filter((s) =>
    profile.sources.some((src) => src.source === s.toUpperCase() && src.connected),
  );
  const [active, setActive] = useState<ActivitySource>(connected[0] ?? "github");
  const shown: ActivitySource = connected.includes(active) ? active : (connected[0] ?? "github");

  if (connected.length === 0) {
    return (
      <ProfileCard title="Activity" action={<ConnectLink>Connect</ConnectLink>} className={className}>
        <p className="m-0 px-4 py-4 text-[13px] leading-[1.5] text-muted-foreground sm:px-5">
          Connect GitHub or LeetCode to see your languages, contributions and solved problems here.
        </p>
      </ProfileCard>
    );
  }

  const body = (s: ActivitySource) => (s === "github" ? <GithubBody profile={profile} /> : <LeetCodeBody profile={profile} />);

  if (connected.length === 1) {
    const only = connected[0];
    const other: ActivitySource = only === "github" ? "leetcode" : "github";
    return (
      <ProfileCard
        title={`${LABEL[only]} activity`}
        meta={handleOf(profile, only)}
        action={<ConnectLink>Connect {LABEL[other]}</ConnectLink>}
        className={className}
      >
        {body(only)}
      </ProfileCard>
    );
  }

  return (
    <Tabs value={shown} onValueChange={(v) => setActive(v as ActivitySource)} className={className}>
      <ProfileCard
        title="Activity"
        meta={handleOf(profile, shown)}
        action={
          <TabsList aria-label="Activity source" className="h-8 rounded-md bg-panel p-0.5">
            {connected.map((s) => (
              <TabsTrigger
                key={s}
                value={s}
                className="h-7 rounded px-2.5 text-xs font-normal text-faint data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-hairline"
              >
                {LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      >
        {connected.map((s) => (
          <TabsContent key={s} value={s} className="mt-0 focus-visible:ring-inset focus-visible:ring-offset-0">
            {body(s)}
          </TabsContent>
        ))}
      </ProfileCard>
    </Tabs>
  );
}
