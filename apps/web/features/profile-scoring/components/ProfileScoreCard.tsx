"use client";

import { HudCard } from "@/components/hud";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Switch } from "@/components/ui/switch";
import { BETA_NOTE, levelLabel, percent } from "../constants";
import { useProfileScore, useRecalculateProfileScore, useScoringSettings } from "../hooks";

const plainScoreValue = (value: number | null | undefined) => value == null ? "Unknown" : `${Math.round(value * 10) / 10}`;

/** Compact, descriptive header readout backed by the same query as the full score card. */
export function ProfileScoreReadout() {
  const query = useProfileScore();
  const score = query.data?.current?.score;
  return (
    <div
      aria-label={`Profile score: ${query.isLoading ? "Loading" : plainScoreValue(score)}`}
      className="flex min-w-[8rem] flex-col border-t border-line-2 pt-3 sm:min-w-[9rem] sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0"
    >
      <span className="iq-eyebrow">Profile score</span>
      <span className="mt-1 font-mono text-2xl tabular-nums tracking-tight">
        {query.isLoading ? "…" : plainScoreValue(score)}
      </span>
      {query.isError ? <span className="text-[11px] text-destructive">Unavailable</span> : null}
    </div>
  );
}

export function ProfileScoreCard() {
  const query = useProfileScore();
  const recalculate = useRecalculateProfileScore();
  const settings = useScoringSettings();
  const current = query.data?.current;
  return <HudCard as="section" aria-label="Beta profile score" className="rounded-[14px] border border-line-2 bg-card p-5" bodyClassName="space-y-4">
    <div><h2 className="m-0 text-base">Profile score <span className="ml-1 rounded-full bg-panel px-2 py-1 text-xs text-muted-foreground">Beta</span></h2>
      <p className="mb-0 mt-2 text-xs leading-relaxed text-muted-foreground">{BETA_NOTE}</p></div>
    {query.isLoading ? <p role="status">Loading profile score…</p> : query.isError || !query.data ? <div>
      <p role="alert" className="text-sm text-destructive">Could not load profile score.</p>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button>
    </div> : <>
      <p className="m-0 font-mono text-3xl tabular-nums tracking-tight" aria-label={`Profile score: ${plainScoreValue(current?.score)}`}>{plainScoreValue(current?.score)}</p>
      {!current || current.score == null ? <p className="text-sm text-muted-foreground">Not enough evidence to assess a score. Unknown does not mean zero.</p> : null}
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-muted-foreground">Scored for level</dt><dd className="m-0 mt-1">{levelLabel(current?.level)}</dd></div>
        <div><dt className="text-muted-foreground">Coverage</dt><dd className="m-0 mt-1 font-mono tabular-nums">{current ? percent(current.coverage) : "Unknown"}</dd></div>
        <div><dt className="text-muted-foreground">Rank / percentile</dt><dd className="m-0 mt-1 font-mono tabular-nums">{current?.percentile == null ? "Unavailable" : current.rank ?? "Unavailable"} / {current?.percentile == null ? "Unavailable" : `${current.percentile.toFixed(1)}%`}</dd></div>
        <div><dt className="text-muted-foreground">Cohort size</dt><dd className="m-0 mt-1 font-mono tabular-nums">{current?.cohortSize ?? "Unavailable"}</dd></div>
      </dl>
      <div className="space-y-2"><p className="m-0 text-xs text-muted-foreground">Declared engineering level</p>
        <p className="m-0 text-sm">{levelLabel(query.data.settings.declaredLevel)}</p>
        <Link href="/profile#profile-level" className="text-xs underline">Edit engineering level in Profile details</Link>
      </div>
      <div className="flex items-center justify-between gap-3"><label htmlFor="profile-leaderboard-opt-in" className="text-sm">Opt in to level leaderboard</label>
        <Switch id="profile-leaderboard-opt-in" checked={query.data.settings.leaderboardOptIn} disabled={settings.isPending || recalculate.isPending}
          onCheckedChange={(leaderboardOptIn) => settings.mutate({ leaderboardOptIn })} /></div>
      <p className="text-xs text-muted-foreground">{query.data.settings.leaderboardOptIn ? "Opted in. Privacy settings may hide your identity or exclude your profile; only eligible same-level peers are compared." : "Hidden from the leaderboard by default. Opt in to participate; privacy settings still apply."} Small or ineligible cohorts have no rank or percentile.</p>
      {current ? <>
        {[...current.warnings, ...current.classification.warnings, ...current.eligibility.reasons].length ? <ul className="space-y-1 pl-4 text-xs text-muted-foreground">
          {[...new Set([...current.warnings, ...current.classification.warnings, ...current.eligibility.reasons])].map((warning) => <li key={warning}>{warning}</li>)}
        </ul> : null}
      </> : null}
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={recalculate.isPending || settings.isPending}
        onClick={() => recalculate.mutate()}>{recalculate.isPending ? "Recalculating…" : "Recalculate profile score"}</Button>
        <Button size="sm" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button></div>
      {recalculate.isPending ? <p role="status" className="text-xs text-muted-foreground">Recalculation requested. Waiting for a new snapshot…</p> : recalculate.isSuccess ? <p role="status" className="text-xs text-muted-foreground">Profile score refreshed.</p> : null}
      {settings.isPending ? <p role="status" className="text-xs text-muted-foreground">Saving settings…</p> : null}
      {settings.isError || recalculate.isError ? <p role="alert" className="text-sm text-destructive">{settings.isError ? "Could not save scoring settings." : "Could not recalculate profile score."} Please retry.</p> : null}
    </>}
  </HudCard>;
}
