import type { CSSProperties } from "react";
import type { LeetCodeFragment, ProfileResponse } from "@/features/profile";
import { PROFILE_SYNC_STATUS } from "@/lib/constants/profile";
import { ROUTES } from "@/lib/constants/shared";
import { LanguageDistribution } from "@/components/visualizations/LanguageDistribution";
import { ProfileCard, CardEmpty } from "./ProfileCard";
import { StatRow, StatTile } from "@/components/patterns";

type SignalSource = "GITHUB" | "LEETCODE";

const SOURCE_LABEL: Record<SignalSource, string> = {
  GITHUB: "GitHub",
  LEETCODE: "LeetCode",
};

const DIFFICULTY_COLOR = {
  easy: "hsl(var(--color-lc-easy))",
  medium: "hsl(var(--color-lc-medium))",
  hard: "hsl(var(--color-lc-hard))",
} as const;

function sourceRecord(profile: ProfileResponse, source: SignalSource) {
  return profile.sources.find((item) => item.source === source);
}

function SourceStatus({ source, connected, partial }: { source: SignalSource; connected: boolean; partial?: boolean }) {
  const label = partial ? "Partial data" : connected ? "Connected" : "Not connected";
  const tone = partial ? "text-amber-700 dark:text-amber-300" : connected ? "text-foreground" : "text-muted-foreground";

  return (
    <span className={`inline-flex items-center gap-1.5 ${tone}`} aria-label={`${SOURCE_LABEL[source]}: ${label}`}>
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${partial ? "bg-amber-500" : connected ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
      />
      {label}
    </span>
  );
}

function ManageSource() {
  return (
    <a
      href={ROUTES.connections}
      className="text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      Manage
    </a>
  );
}

function SyncEmpty({ source, status, connected = false }: { source: SignalSource; status?: string; connected?: boolean }) {
  const label = SOURCE_LABEL[source];
  if (status === PROFILE_SYNC_STATUS.syncing) {
    return <CardEmpty title={`Importing your ${label} data`} hint="Your source signals will appear here when the first import finishes." />;
  }
  if (status === PROFILE_SYNC_STATUS.failed || status === PROFILE_SYNC_STATUS.degraded) {
    return <CardEmpty title={`${label} data is unavailable`} hint="We could not read the complete source snapshot. Try refreshing the connection from Connections." />;
  }
  if (connected) {
    return <CardEmpty title={`${label} data is unavailable`} hint="This source is connected, but no readable snapshot is available yet. Try refreshing from Connections." />;
  }
  return <CardEmpty title={`Connect ${label}`} hint={`Connect ${label} to show source-only activity on your profile.`} />;
}

function GithubSignalCard({ profile }: { profile: ProfileResponse }) {
  const github = profile.fragments.github;
  const source = sourceRecord(profile, "GITHUB");
  const connected = source?.connected ?? Boolean(github);

  return (
    <ProfileCard
      title="GitHub profile"
      meta={github?.login ? `@${github.login}` : <SourceStatus source="GITHUB" connected={connected} />}
      action={<ManageSource />}
    >
      {!github ? (
         <SyncEmpty source="GITHUB" status={source?.status} connected={connected} />
      ) : (
        <div className="flex flex-col gap-5 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
            <SourceStatus source="GITHUB" connected={connected} />
            <span>{github.name || "Public profile"}</span>
          </div>
          <StatRow className="grid-cols-3 divide-y-0 sm:grid-cols-3">
            <StatTile value={github.publicRepos.toLocaleString()} label="Public repos" className="px-3 py-4 sm:px-4" />
            <StatTile value={github.contributions.lastYear.toLocaleString()} label="Contributions · 1y" className="px-3 py-4 sm:px-4" />
            <StatTile value={github.externalPRs.toLocaleString()} label="External PRs" className="px-3 py-4 sm:px-4" />
          </StatRow>
          <div className="flex flex-col gap-2.5">
            <p className="iq-eyebrow m-0">Languages</p>
            {github.languages.length ? (
              <LanguageDistribution languages={github.languages} />
            ) : (
              <p className="m-0 text-[13px] text-muted-foreground">No language data yet.</p>
            )}
          </div>
        </div>
      )}
    </ProfileCard>
  );
}

function difficultyTotal(solved: LeetCodeFragment["solved"]): number {
  return solved.easy + solved.medium + solved.hard;
}

function DifficultyBlocks({ solved }: { solved: LeetCodeFragment["solved"] }) {
  const blocks = [
    { key: "easy", label: "Easy", value: solved.easy },
    { key: "medium", label: "Medium", value: solved.medium },
    { key: "hard", label: "Hard", value: solved.hard },
  ] as const;

  return (
    <div aria-label="Problems solved by difficulty" className="grid grid-cols-3 gap-2">
      {blocks.map((block) => {
        const color = DIFFICULTY_COLOR[block.key];
        return (
          <div
            key={block.key}
            aria-label={`${block.label}: ${block.value.toLocaleString()} solved`}
            className="flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-3"
            style={{ borderColor: color, color } as CSSProperties}
          >
            <span className="text-[11px] uppercase tracking-[0.12em]">{block.label}</span>
            <span className="font-mono text-xl tabular-nums text-foreground">{block.value.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

function LeetCodeSignalCard({ profile }: { profile: ProfileResponse }) {
  const leetcode = profile.fragments.leetcode;
  const source = sourceRecord(profile, "LEETCODE");
  const connected = source?.connected ?? Boolean(leetcode);
  const topicCount = leetcode?.byTopic.filter((topic) => topic.count > 0).length ?? 0;

  return (
    <ProfileCard
      title="LeetCode profile"
      meta={leetcode?.username ? `@${leetcode.username}` : <SourceStatus source="LEETCODE" connected={connected} partial={leetcode?.partial} />}
      action={<ManageSource />}
    >
      {!leetcode ? (
         <SyncEmpty source="LEETCODE" status={source?.status} connected={connected} />
      ) : (
        <div className="flex flex-col gap-5 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
            <SourceStatus source="LEETCODE" connected={connected} partial={leetcode.partial} />
            {leetcode.country ? <span>{leetcode.country}</span> : null}
          </div>
          {leetcode.partial ? (
            <p role="status" className="m-0 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[13px] leading-[1.45] text-muted-foreground">
              Some LeetCode data could not be imported; unavailable fields are shown as em dashes.
            </p>
          ) : null}
          <StatRow className="grid-cols-2 divide-y-0 sm:grid-cols-2">
            <StatTile value={(leetcode.solved.total ?? difficultyTotal(leetcode.solved)).toLocaleString()} label="Problems solved" className="px-3 py-4 sm:px-4" />
            <StatTile value={leetcode.contest ? leetcode.contest.rating.toLocaleString() : "—"} label="Contest rating" className="px-3 py-4 sm:px-4" />
          </StatRow>
          <div className="flex flex-col gap-2.5">
            <p className="iq-eyebrow m-0">By difficulty</p>
            <DifficultyBlocks solved={leetcode.solved} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
            <span aria-label={`${topicCount.toLocaleString()} topics covered`}>
              <span className="font-mono tabular-nums text-foreground">{topicCount.toLocaleString()}</span>{" "}
              topics covered
            </span>
            {leetcode.recentActivity?.preferredLanguage ? <span>Recent language: {leetcode.recentActivity.preferredLanguage}</span> : null}
          </div>
        </div>
      )}
    </ProfileCard>
  );
}

/** Separate, descriptive source snapshots. These are source stats only — never a score or grade. */
export function SourceSignalCards({ profile }: { profile: ProfileResponse }) {
  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-2">
      <GithubSignalCard profile={profile} />
      <LeetCodeSignalCard profile={profile} />
    </div>
  );
}
