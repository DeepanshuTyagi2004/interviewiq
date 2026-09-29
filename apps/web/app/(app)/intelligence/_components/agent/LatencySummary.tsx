"use client";

import type { AgentTurn } from "@/features/agent-diagnostics";

/**
 * Latency breakdown for the whole session: aggregates each step's wall-time (`duration_ms`) by
 * step name across all turns, sorted slowest-total first — so you can see at a glance where the
 * time goes (usually the LLM steps: grade / converse / classify). Pairs with the drawer's
 * per-call `Model time` + token counts, which separate the model round-trip from harness overhead.
 */
export function LatencySummary({ turns }: { turns: AgentTurn[] }) {
  const agg = new Map<string, { count: number; total: number; max: number }>();
  let sessionTotal = 0;
  for (const t of turns) {
    for (const s of t.steps) {
      const ms = s.duration_ms ?? 0;
      sessionTotal += ms;
      const a = agg.get(s.name) ?? { count: 0, total: 0, max: 0 };
      a.count += 1;
      a.total += ms;
      a.max = Math.max(a.max, ms);
      agg.set(s.name, a);
    }
  }
  const rows = [...agg.entries()].sort((x, y) => y[1].total - x[1].total);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between text-sm font-medium">
        <span>Latency by step</span>
        <span className="text-xs font-normal text-muted-foreground">session total {fmt(sessionTotal)}</span>
      </div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left font-normal">Step</th>
            <th className="text-right font-normal">n</th>
            <th className="text-right font-normal">total</th>
            <th className="text-right font-normal">avg</th>
            <th className="text-right font-normal">max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, a]) => (
            <tr key={name} className="border-t border-border/50">
              <td className="py-0.5">{name}</td>
              <td className="text-right tabular-nums">{a.count}</td>
              <td className="text-right font-medium tabular-nums">{fmt(a.total)}</td>
              <td className="text-right tabular-nums">{fmt(a.total / a.count)}</td>
              <td className="text-right tabular-nums">{fmt(a.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
