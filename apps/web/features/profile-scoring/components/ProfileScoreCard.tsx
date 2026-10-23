"use client";

import { Card, Chip, Stat } from "@/components/ds";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ROUTES } from "@/lib/constants/shared";
import { Switch } from "@/components/ui/switch";
import { BETA_NOTE, levelLabel, percent } from "../constants";
import { useProfileScore, useRecalculateProfileScore, useScoringSettings } from "../hooks";

const plainScoreValue = (value: number | null | undefined) => value == null ? "Unknown" : `${Math.round(value * 10) / 10}`;

/** Header readout backed by the same query as the full score card: the score as a Stat with its BETA chip. */
export function ProfileScoreReadout() {
  const query = useProfileScore();
  const score = query.data?.current?.score;
  return (
    <div role="group" aria-label={`Profile score: ${query.isLoading ? "Loading" : plainScoreValue(score)}`} className="min-w-[8rem]">
      <Stat
        label={
          <span className="inline-flex items-center gap-2">
            Profile score <Chip tone="outline" className="h-5 px-2 text-xs">BETA</Chip>
          </span>
        }
        value={query.isLoading ? "…" : plainScoreValue(score)}
        note={query.isError ? <span className="text-destructive">Unavailable</span> : undefined}
      />
    </div>
  );
}

export function ProfileScoreCard() {
  const query = useProfileScore();
  const recalculate = useRecalculateProfileScore();
  const settings = useScoringSettings();
  const current = query.data?.current;
  return <Card as="section" aria-label="Beta profile score" title="Profile score" action={<Chip tone="outline">Beta</Chip>} bodyClassName="space-y-5">
    <p className="m-0 text-[13px] leading-relaxed text-ink-2">{BETA_NOTE}</p>
    <Link
      href={ROUTES.profileScore}
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-[14px] font-medium underline underline-offset-4 outline-none hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-brand"
    >
      How your score is calculated, and how to raise it
      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
    </Link>
    {query.isLoading ? <p role="status">Loading profile score…</p> : query.isError || !query.data ? <div>
      <p role="alert" className="text-sm text-destructive">Could not load profile score.</p>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button>
    </div> : <>
      <div role="group" aria-label={`Profile score: ${plainScoreValue(current?.score)}`}><Stat label="Current score" value={plainScoreValue(current?.score)} /></div>
      {!current || current.score == null ? <p className="text-sm text-ink-2">Not enough evidence to assess a score. Unknown does not mean zero.</p> : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5 text-[13px]">
        <div><dt className="text-ink-3">Scored for level</dt><dd className="m-0 mt-1">{levelLabel(current?.level)}</dd></div>
        <div><dt className="text-ink-3">Coverage</dt><dd className="m-0 mt-1 font-mono tabular-nums">{current ? percent(current.coverage) : "Unknown"}</dd></div>
        <div><dt className="text-ink-3">Rank / percentile</dt><dd className="m-0 mt-1 font-mono tabular-nums">{current?.percentile == null ? "Unavailable" : current.rank ?? "Unavailable"} / {current?.percentile == null ? "Unavailable" : `${current.percentile.toFixed(1)}%`}</dd></div>
        <div><dt className="text-ink-3">Cohort size</dt><dd className="m-0 mt-1 font-mono tabular-nums">{current?.cohortSize ?? "Unavailable"}</dd></div>
      </dl>
      <div className="space-y-2"><p className="m-0 text-[13px] text-ink-3">Declared engineering level</p>
        <p className="m-0 text-sm">{levelLabel(query.data.settings.declaredLevel)}</p>
        <Link href="/profile#profile-level" className="text-[13px] underline underline-offset-4 hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">Edit engineering level in Profile details</Link>
      </div>
      <div className="flex items-center justify-between gap-3"><label htmlFor="profile-leaderboard-opt-in" className="text-sm">Opt in to level leaderboard</label>
        <Switch id="profile-leaderboard-opt-in" checked={query.data.settings.leaderboardOptIn} disabled={settings.isPending || recalculate.isPending}
          onCheckedChange={(leaderboardOptIn) => settings.mutate({ leaderboardOptIn })} /></div>
      <p className="text-xs text-ink-2">{query.data.settings.leaderboardOptIn ? "Opted in. Privacy settings may hide your identity or exclude your profile; only eligible same-level peers are compared." : "Hidden from the leaderboard by default. Opt in to participate; privacy settings still apply."} Small or ineligible cohorts have no rank or percentile.</p>
      {current ? <>
        {[...current.warnings, ...current.classification.warnings, ...current.eligibility.reasons].length ? <ul className="space-y-1 pl-4 text-xs text-ink-2">
          {[...new Set([...current.warnings, ...current.classification.warnings, ...current.eligibility.reasons])].map((warning) => <li key={warning}>{warning}</li>)}
        </ul> : null}
      </> : null}
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={recalculate.isPending || settings.isPending}
        onClick={() => recalculate.mutate()}>{recalculate.isPending ? "Recalculating…" : "Recalculate profile score"}</Button>
        <Button size="sm" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button></div>
      {recalculate.isPending ? <p role="status" className="text-xs text-ink-2">Recalculation requested. Waiting for a new snapshot…</p> : recalculate.isSuccess ? <p role="status" className="text-xs text-ink-2">Profile score refreshed.</p> : null}
      {settings.isPending ? <p role="status" className="text-xs text-ink-2">Saving settings…</p> : null}
      {settings.isError || recalculate.isError ? <p role="alert" className="text-sm text-destructive">{settings.isError ? "Could not save scoring settings." : "Could not recalculate profile score."} Please retry.</p> : null}
    </>}
  </Card>;
}
