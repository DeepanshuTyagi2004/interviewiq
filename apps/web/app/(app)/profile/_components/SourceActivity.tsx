import type { ProfileResponse } from "@/features/profile";
import { PROFILE_SYNC_STATUS } from "@/lib/constants/profile";
import { ContributionHeatmap } from "@/components/visualizations/ContributionHeatmap";
import { GithubStatTiles } from "@/components/visualizations/GithubStatTiles";
import { LanguageDistribution } from "@/components/visualizations/LanguageDistribution";
import { LeetCodeDifficulty } from "@/components/visualizations/LeetCodeDifficulty";
import { LeetCodeStatTiles, prettyLang } from "@/components/visualizations/LeetCodeStatTiles";
import { LeetCodeTopics } from "@/components/visualizations/LeetCodeTopics";
import { CardEmpty, ProfileCard } from "./ProfileCard";

/** Stat rows sit flush under the card header, divided from the charts by one hairline. */
const FLUSH_STATS = "rounded-none border-0 border-b border-line";

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="iq-eyebrow m-0">{label}</p>
      {children}
    </div>
  );
}

/** GitHub languages, repos and a year of contributions — counts and shares only. */
export function GithubActivity({ profile }: { profile: ProfileResponse }) {
  const github = profile.fragments.github;
  const connected = profile.sources.some((s) => s.source === "GITHUB" && s.connected);

  if (!connected || !github) {
    return (
      <ProfileCard title="GitHub">
        <CardEmpty
          title={connected ? "Importing your GitHub data" : "GitHub not connected"}
          hint={
            connected
              ? "Your languages, repos and contributions appear here once the first import finishes."
              : "Connect GitHub under Connected sources to see your languages, repos and contributions."
          }
        />
      </ProfileCard>
    );
  }

  return (
    <ProfileCard title="GitHub" meta={github.login ? `@${github.login}` : undefined}>
      <GithubStatTiles github={github} className={FLUSH_STATS} />
      <div className="flex flex-col gap-7 px-4 py-5 sm:px-5">
        <Block label="Languages">
          <LanguageDistribution languages={github.languages} />
        </Block>
        <Block label="Contributions">
          <ContributionHeatmap weeks={github.contributions.weeks} totalLastYear={github.contributions.lastYear} />
        </Block>
      </div>
    </ProfileCard>
  );
}

/** LeetCode solved counts by difficulty and topic, plus LeetCode's own contest numbers. */
export function LeetCodeActivity({ profile }: { profile: ProfileResponse }) {
  const leetcode = profile.fragments.leetcode;
  const source = profile.sources.find((s) => s.source === "LEETCODE");

  if (!leetcode) {
    const syncing = source?.connected && source.status === PROFILE_SYNC_STATUS.syncing;
    return (
      <ProfileCard title="LeetCode">
        <CardEmpty
          title={source?.connected ? (syncing ? "Importing your LeetCode data" : "No LeetCode data yet") : "LeetCode not connected"}
          hint={
            source?.connected
              ? "Solved problems by difficulty and topic appear here once the import finishes."
              : "Connect LeetCode under Connected sources to see solved problems by difficulty and topic."
          }
        />
      </ProfileCard>
    );
  }

  const preferred = leetcode.recentActivity?.preferredLanguage;

  return (
    <ProfileCard title="LeetCode" meta={leetcode.username ? `@${leetcode.username}` : undefined}>
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
    </ProfileCard>
  );
}
