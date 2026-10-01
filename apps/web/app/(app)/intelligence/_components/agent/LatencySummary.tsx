"use client";

import { ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
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
    <ConsoleCard title="Latency by step" meta={<HeaderCount>session total {fmt(sessionTotal)}</HeaderCount>}>
      <HairlineTable label="Latency by step" className="min-w-[420px] text-[13px]">
        <HairlineHead>
          <Th className="py-2.5">Step</Th>
          <Th className="py-2.5 text-right">n</Th>
          <Th className="py-2.5 text-right">total</Th>
          <Th className="py-2.5 text-right">avg</Th>
          <Th className="py-2.5 text-right">max</Th>
        </HairlineHead>
        <tbody>
          {rows.map(([name, a]) => (
            <Tr key={name}>
              <Td className="py-2 font-mono text-[12.5px]">{name}</Td>
              <Td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{a.count}</Td>
              <Td className="py-2 text-right font-mono tabular-nums">{fmt(a.total)}</Td>
              <Td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{fmt(a.total / a.count)}</Td>
              <Td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{fmt(a.max)}</Td>
            </Tr>
          ))}
        </tbody>
      </HairlineTable>
    </ConsoleCard>
  );
}

function fmt(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
