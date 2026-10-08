"use client";

import * as React from "react";
import { HudCard, HudEmpty } from "@/components/hud";
import { MonoPill } from "@/components/patterns";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { useBlueprintDiff, useBlueprintVersions, type BlueprintDiff } from "@/features/blueprints";
import { timeAgo } from "@/features/research";
import { ApiFetchError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";
import { inline, shortHash } from "./format";
import { FIELD, Facts, Section } from "./ui";

/**
 * A session's blueprint versions, and a structured diff between any two of them: which input parts
 * changed, which slot problems changed, whether the persona changed, and every changed path.
 */
export function VersionsDiff({
  sessionId,
  currentRunId,
  onSelectRun,
}: {
  sessionId: string;
  currentRunId: string;
  onSelectRun: (id: string) => void;
}) {
  const versions = useBlueprintVersions(sessionId);
  const list = React.useMemo(
    () => [...(versions.data?.versions ?? [])].filter((v) => v.version != null).sort((a, b) => (b.version ?? 0) - (a.version ?? 0)),
    [versions.data],
  );
  const [picked, setPicked] = React.useState<{ from: number | null; to: number | null }>({ from: null, to: null });
  // Default: the previous version against the newest.
  const to = picked.to ?? list[0]?.version ?? null;
  const from = picked.from ?? list[1]?.version ?? null;
  const diff = useBlueprintDiff(sessionId, from, to);

  return (
    <HudCard title="Versions" spotlight={false} meta={<span>{list.length}</span>} bodyClassName="flex flex-col">
      {versions.isPending ? (
        <p className="m-0 px-4 py-3 text-[13px] text-muted-foreground sm:px-5">Loading versions…</p>
      ) : versions.isError ? (
        <p role="alert" className="m-0 px-4 py-3 text-[13px] text-destructive sm:px-5">
          Could not load versions: {versions.error instanceof ApiFetchError ? versions.error.message : "unknown error"}
        </p>
      ) : list.length === 0 ? (
        <HudEmpty title="No saved versions" hint="A session gets a version each time a run completes and validates." />
      ) : (
        <>
          <HairlineTable label="Blueprint versions" className="text-[12.5px]">
            <HairlineHead>
              <Th>Version</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th>Input hash</Th>
              <Th>Run</Th>
            </HairlineHead>
            <tbody>
              {list.map((v) => (
                <Tr key={v.version} className={cn(v.run_id === currentRunId && "bg-accent")}>
                  <Td className="py-2 font-mono">v{v.version}</Td>
                  <Td className="py-2">{v.status ?? "—"}</Td>
                  <Td className="py-2">{v.created_at ? <time dateTime={v.created_at} title={v.created_at}>{timeAgo(v.created_at)}</time> : "—"}</Td>
                  <Td className="py-2 font-mono" title={v.input_hash}>{shortHash(v.input_hash)}</Td>
                  <Td className="py-2">
                    {v.run_id ? (
                      v.run_id === currentRunId ? (
                        <span className="font-mono text-faint">this run</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectRun(v.run_id!)}
                          className="rounded-sm font-mono underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {v.run_id.slice(0, 12)}
                        </button>
                      )
                    ) : (
                      "—"
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </HairlineTable>

          {list.length > 1 ? (
            <div className="space-y-4 border-t border-line px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-muted-foreground">Compare</span>
                <select
                  aria-label="From version"
                  className={FIELD}
                  value={from ?? ""}
                  onChange={(e) => setPicked({ from: Number(e.target.value) || null, to })}
                >
                  {list.map((v) => (
                    <option key={v.version} value={v.version}>v{v.version}</option>
                  ))}
                </select>
                <span aria-hidden className="text-faint">→</span>
                <select
                  aria-label="To version"
                  className={FIELD}
                  value={to ?? ""}
                  onChange={(e) => setPicked({ from, to: Number(e.target.value) || null })}
                >
                  {list.map((v) => (
                    <option key={v.version} value={v.version}>v{v.version}</option>
                  ))}
                </select>
              </div>
              {from === to ? (
                <p className="m-0 text-xs text-faint">Pick two different versions.</p>
              ) : diff.isPending ? (
                <p className="m-0 text-[13px] text-muted-foreground">Comparing…</p>
              ) : diff.isError ? (
                <p role="alert" className="m-0 text-[13px] text-destructive">
                  Could not diff: {diff.error instanceof ApiFetchError ? diff.error.message : "unknown error"}
                </p>
              ) : diff.data ? (
                <DiffView diff={diff.data} />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </HudCard>
  );
}

export function DiffView({ diff }: { diff: BlueprintDiff }) {
  const problems = Object.entries(diff.problems_changed ?? {});
  return (
    <div className="space-y-4">
      <Facts
        items={[
          ["Inputs changed", diff.inputs_changed.length ? (
            <span key="i" className="flex flex-wrap gap-1.5">
              {diff.inputs_changed.map((p) => (
                <MonoPill key={p} tone="ink">{p}</MonoPill>
              ))}
            </span>
          ) : "none"],
          ["Persona changed", diff.persona_changed ? "yes" : "no"],
        ]}
      />
      <Section title={`Problems changed · ${problems.length}`}>
        {problems.length ? (
          <ul className="m-0 list-none space-y-1 p-0 font-mono text-[12px]">
            {problems.map(([slot, change]) => (
              <li key={slot} className="[overflow-wrap:anywhere]">
                <span className="text-faint">{slot}: </span>
                {change.from ?? "—"} <span aria-hidden className="text-faint">→</span>
                <span className="sr-only"> to </span> {change.to ?? "—"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-xs text-faint">No slot got a different problem.</p>
        )}
      </Section>
      <Section title={`Changes · ${diff.changes.length}`}>
        {diff.truncated ? (
          <p role="note" className="m-0 text-xs text-muted-foreground">Truncated: the server sent only the first changes.</p>
        ) : null}
        {diff.changes.length ? (
          <HairlineTable label="Changed paths" className="min-w-[640px] text-[12px]">
            <HairlineHead>
              <Th>Path</Th>
              <Th>From</Th>
              <Th>To</Th>
            </HairlineHead>
            <tbody>
              {diff.changes.map((c, i) => (
                <Tr key={`${c.path}-${i}`}>
                  <Td className="py-1.5 align-top font-mono">{c.path ?? "—"}</Td>
                  <Td className="py-1.5 align-top text-muted-foreground [overflow-wrap:anywhere]">{inline(c.from)}</Td>
                  <Td className="py-1.5 align-top [overflow-wrap:anywhere]">{inline(c.to)}</Td>
                </Tr>
              ))}
            </tbody>
          </HairlineTable>
        ) : (
          <p className="m-0 text-xs text-faint">No changed paths.</p>
        )}
      </Section>
    </div>
  );
}
