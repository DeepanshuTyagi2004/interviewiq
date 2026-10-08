"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { ConsoleCard } from "@/components/observability/ConsoleCard";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { BETA_NOTE, LEVEL_OPTIONS, levelLabel, useProfileLeaderboard, useProfileScore, type EngineeringLevel } from "@/features/profile-scoring";
import { isEngineeringLevel } from "@/lib/constants/engineering-levels";
import Link from "next/link";

export function ProfileLeaderboard() {
  const profile = useProfileScore();
  const [chosenLevel, setChosenLevel] = useState<EngineeringLevel | null>(null);
  const level = chosenLevel ?? profile.data?.settings.declaredLevel ?? profile.data?.current?.level ?? "fresher";
  const query = useProfileLeaderboard(level, !profile.isLoading);
  // Never render a stale response from a different level as a universal ranking.
  const data = query.data?.level === level ? query.data : undefined;
  return <div className="mt-5 space-y-5">
    <p className="m-0 text-sm text-muted-foreground">{BETA_NOTE} Only opted-in, eligible profiles at the same engineering level, week and algorithm version are compared.</p>
    <div className="max-w-xs"><CustomSelect label="Leaderboard engineering level" value={level} options={LEVEL_OPTIONS}
      onValueChange={(value) => { if (isEngineeringLevel(value)) setChosenLevel(value); }} /></div>
    <p className="m-0 text-xs text-muted-foreground">{profile.isLoading ? "Checking your participation settings…" : profile.isError ? "Your participation settings are unavailable. Check your profile before opting in." : profile.data?.settings.leaderboardOptIn ? "You are opted in. Privacy settings can hide your identity or exclude your profile." : "Your profile is hidden by default. Opt in on your profile to participate."} <Link className="underline underline-offset-4" href="/profile">Manage participation</Link></p>
    <ConsoleCard title={`${levelLabel(level)} profile leaderboard`} meta={data ? <span className="text-xs text-muted-foreground">{data.total} eligible profiles</span> : null}>
      {profile.isLoading || query.isLoading || (query.isFetching && !data) ? <p role="status" className="p-5 text-sm">Loading {levelLabel(level)} leaderboard…</p> : query.isError ? <div className="p-5">
        <p role="alert" className="text-sm text-destructive">Could not load the leaderboard.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
      </div> : !data || data.entries.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No eligible {levelLabel(level)} cohort available yet. Small cohorts are not ranked.</p> : <>
        <p className="m-0 border-b border-line-2 px-5 py-3 text-xs text-muted-foreground">Week {data.week} · {data.algorithmVersion} · Same-level comparison only</p>
        <HairlineTable label={`${levelLabel(level)} rankings`} className="min-w-[520px]">
          <HairlineHead><Th>Rank</Th><Th>Profile</Th><Th>Profile score</Th><Th>Percentile</Th></HairlineHead>
          <tbody>{data.entries.map((entry, index) => <Tr key={`${entry.rank}-${index}`}><Td className="font-mono">{entry.percentile == null ? "Unavailable" : entry.rank}</Td><Td>{entry.displayName}</Td>
            <Td className="font-mono tabular-nums">{entry.score.toFixed(1)} / 100</Td><Td className="font-mono tabular-nums">{entry.percentile == null ? "Unavailable" : `${entry.percentile.toFixed(1)}%`}</Td></Tr>)}</tbody>
        </HairlineTable>
      </>}
    </ConsoleCard>
  </div>;
}
