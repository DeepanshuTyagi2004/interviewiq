"use client";

import { useState } from "react";
import Link from "next/link";
import { EmptyState, Orb, SectionHeader } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BETA_NOTE, LEVEL_OPTIONS, levelLabel, useProfileLeaderboard, useProfileScore, type EngineeringLevel } from "@/features/profile-scoring";
import { cn } from "@/lib/utils/cn";

export function ProfileLeaderboard() {
  const profile = useProfileScore();
  const [chosenLevel, setChosenLevel] = useState<EngineeringLevel | null>(null);
  const level = chosenLevel ?? profile.data?.settings.declaredLevel ?? profile.data?.current?.level ?? "fresher";
  const query = useProfileLeaderboard(level, !profile.isLoading);
  // Never render a stale response from a different level as a universal ranking.
  const data = query.data?.level === level ? query.data : undefined;
  const loading = profile.isLoading || query.isLoading || (query.isFetching && !data);
  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 max-w-3xl text-[14px] leading-[1.55] text-ink-2">
        {BETA_NOTE} Only opted-in, eligible profiles at the same engineering level, week and algorithm version are compared.
      </p>

      <div className="-mx-1 overflow-x-auto px-1 py-1">
        <div role="radiogroup" aria-label="Leaderboard engineering level" className="inline-flex h-10 items-center rounded-full bg-surface-2 p-1">
          {LEVEL_OPTIONS.map((o) => {
            const selected = o.value === level;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setChosenLevel(o.value)}
                className={cn(
                  "inline-flex h-8 flex-none items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-150 ease-iq focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected ? "bg-background text-foreground shadow-ring" : "text-ink-2 hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="m-0 text-[13px] leading-[1.5] text-ink-3">
        {profile.isLoading
          ? "Checking your participation settings…"
          : profile.isError
            ? "Your participation settings are unavailable. Check your profile before opting in."
            : profile.data?.settings.leaderboardOptIn
              ? "You are opted in. Privacy settings can hide your identity or exclude your profile."
              : "Your profile is hidden by default. Opt in on your profile to participate."}{" "}
        <Link className="text-ink-2 underline underline-offset-4 hover:text-foreground" href="/profile">
          Manage participation
        </Link>
      </p>

      <section aria-label={`${levelLabel(level)} profile leaderboard`}>
        <SectionHeader
          title={`${levelLabel(level)} profile leaderboard`}
          actions={data ? <span className="text-[13px] text-ink-3">{data.total} eligible profiles</span> : null}
        />
        {loading ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-2 rounded-tile p-4 shadow-ring">
            <span className="sr-only">Loading {levelLabel(level)} leaderboard…</span>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-start gap-3 rounded-tile px-5 py-6 shadow-ring">
            <p role="alert" className="m-0 text-sm text-destructive">
              Could not load the leaderboard.
            </p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div className="rounded-tile shadow-ring">
            <EmptyState
              title={`No eligible ${levelLabel(level)} cohort available yet`}
              hint="Small cohorts are not ranked. Check back as more people at this level opt in."
            />
          </div>
        ) : (
          <>
            <p className="m-0 mb-3 text-[13px] text-ink-3">
              Week {data.week} · {data.algorithmVersion} · Same-level comparison only
            </p>
            <Table className="min-w-[560px]" aria-label={`${levelLabel(level)} rankings`}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-20 px-5">Rank</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Profile score</TableHead>
                  <TableHead className="pr-5">Percentile</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.entries.map((entry, index) => (
                  <TableRow key={`${entry.rank}-${index}`}>
                    <TableCell className="px-5 font-mono tabular-nums">{entry.percentile == null ? "Unavailable" : entry.rank}</TableCell>
                    <TableCell>
                      <span className="flex min-w-0 items-center gap-3">
                        <Orb seed={entry.displayName} size={28} />
                        <span className="max-w-[260px] truncate" title={entry.displayName}>
                          {entry.displayName}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono tabular-nums">{entry.score.toFixed(1)} / 100</TableCell>
                    <TableCell className="pr-5 font-mono tabular-nums">{entry.percentile == null ? "Unavailable" : `${entry.percentile.toFixed(1)}%`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </section>
    </div>
  );
}
