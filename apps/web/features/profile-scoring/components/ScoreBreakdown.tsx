import { levelLabel, percent, scoreValue } from "../constants";
import type { ProfileScoreSnapshot } from "../types";

/** Scores can move weekly under the same rubric; ranks reflect each week's eligible population. */
export function snapshotDelta(current: ProfileScoreSnapshot, previous: ProfileScoreSnapshot) {
  if (current.level !== previous.level || current.algorithmVersion !== previous.algorithmVersion ||
    current.configHash !== previous.configHash) return null;
  return {
    score: current.score == null || previous.score == null ? null : current.score - previous.score,
    rank: current.rank == null || previous.rank == null || current.percentile == null || previous.percentile == null ? null : previous.rank - current.rank,
  };
}

export function ScoreBreakdown({ snapshot }: { snapshot: ProfileScoreSnapshot }) {
  return <details className="rounded-lg border border-line-2 p-3">
    <summary className="cursor-pointer text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">Evidence & component breakdown</summary>
    <p className="mt-3 text-xs text-muted-foreground">{snapshot.components.some((component) => component.role)
      ? `Every part is expected at ${levelLabel(snapshot.level)} in proportion to its weight; missing evidence counts as 0. Core parts are the ones nothing else can stand in for; the rest are extra credit.`
      : `Missing evidence is unknown, never a negative score. Weights apply to ${levelLabel(snapshot.level)}.`}</p>
    <ul className="space-y-3 p-0">
      {snapshot.components.map((component) => <li key={component.id} className="list-none rounded-lg bg-panel p-3 text-sm">
        <p className="m-0">{component.label}{component.role ? ` · ${component.role === "core" ? "Core" : "Extra"}` : ""} · Weight {percent(component.weight)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{component.status === "available" ? "Available" : component.status === "pending" ? "Waiting for assessment" : "Missing (counts as 0)"} · {scoreValue(component.score)} · Contribution {component.contribution == null ? "None" : component.contribution.toFixed(1)}</p>
        {component.evidenceIds.length === 0 ? <p className="text-xs text-muted-foreground">No evidence</p> : <ul className="space-y-2 pl-4">
          {component.evidenceIds.map((id) => {
            const evidence = snapshot.evidence.find((item) => item.id === id);
            return <li key={id} className="text-xs">{evidence ? <>
              <span className="break-words">{evidence.claim}</span>
              <span className="block break-words font-mono text-muted-foreground">Observed value: {evidence.value} · Recency factor: {evidence.recencyFactor.toFixed(2)}</span>
              <span className="block text-muted-foreground">{evidence.source} · {evidence.verification.replaceAll("_", " ")}{evidence.observedAt ? ` · ${evidence.observedAt}` : ""}</span>
              <span className="block break-words font-mono text-muted-foreground">{evidence.id} · {evidence.path}</span>
              {evidence.paths && evidence.paths.length > 1 ? <span className="block break-words text-muted-foreground">Shared claim paths: {evidence.paths.join(" · ")} (counted once)</span> : null}
              {evidence.provenance?.length ? <ul className="mt-1 space-y-1 pl-4 text-muted-foreground">{evidence.provenance.map((receipt, index) => <li key={`${receipt.path}-${index}`}>
                {receipt.section} · {receipt.path}{receipt.file ? ` · ${receipt.file}` : ""}: <q>{receipt.quote}</q>
              </li>)}</ul> : null}
            </> : "Referenced evidence unavailable"}</li>;
          })}
        </ul>}
      </li>)}
    </ul>
    <h3 className="text-sm font-medium">Source freshness</h3>
    <ul className="space-y-1 pl-4 text-xs text-muted-foreground">{snapshot.sources.map((source) => <li key={source.source}>
      {source.source} · {source.status} · {source.fetchedAt ?? "Never fetched"}{source.ageDays == null ? "" : ` · ${source.ageDays} days old`}
      {source.importMethod ? <span className="block">{source.importMethod === "url" ? "Public URL snapshot" : `${source.importMethod} import`}{source.provider ? ` via ${source.provider}` : ""} · Self-reported, not verified employment{source.retrievedAt ? ` · Retrieved ${source.retrievedAt}` : ""}{source.importedAt ? ` · Confirmed ${source.importedAt}` : ""}</span> : null}
    </li>)}</ul>
  </details>;
}

export function ScoreHistory({ history }: { history: ProfileScoreSnapshot[] }) {
  return <details className="rounded-lg border border-line-2 p-3">
    <summary className="cursor-pointer text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">Score history</summary>
    <p className="text-xs text-muted-foreground">Weekly changes compare the same level and scoring configuration. Rank movement reflects each week&apos;s eligible cohort; its membership may change.</p>
    {history.length === 0 ? <p className="text-xs text-muted-foreground">No historical snapshots yet.</p> : <ol className="space-y-3 pl-4 text-xs">
      {history.map((snapshot, index) => {
        const previous = history[index + 1];
        const delta = previous ? snapshotDelta(snapshot, previous) : null;
        return <li key={snapshot.id}>
           {snapshot.calculatedAt} · {levelLabel(snapshot.level)} · {scoreValue(snapshot.score)} · Rank {snapshot.percentile == null ? "Unavailable" : snapshot.rank ?? "Unavailable"} · Cohort {snapshot.cohortSize} · {snapshot.algorithmVersion}
           {previous ? <p className="m-0 mt-1 text-muted-foreground">{delta ? `Score Δ ${delta.score == null ? "Unknown" : delta.score.toFixed(1)} · Rank Δ ${delta.rank ?? "Unavailable"}` : "Not comparable: different level, version or configuration."}</p> : null}
        </li>;
      })}
    </ol>}
  </details>;
}
