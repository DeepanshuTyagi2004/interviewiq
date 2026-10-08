"use client";

import { HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import type { BlueprintBranch } from "@/features/blueprints";
import { COMMON_CONDITIONS, FAMILY_CONDITIONS, FAMILY_LABEL, familyOf } from "../vocabulary";

interface Group {
  title: string;
  rows: BlueprintBranch[];
}

/** Branches in vocabulary order, grouped: the conditions every round has, then the round family's own. */
function groupBranches(branches: BlueprintBranch[], roundType: string): { groups: Group[]; missing: string[] } {
  const family = familyOf(roundType);
  const common = COMMON_CONDITIONS;
  const own = FAMILY_CONDITIONS[family];
  const order = (list: readonly string[]) =>
    branches.filter((b) => list.includes(b.condition)).sort((a, b) => list.indexOf(a.condition) - list.indexOf(b.condition));
  const other = branches.filter((b) => !common.includes(b.condition) && !own.includes(b.condition));
  const covered = new Set(branches.map((b) => b.condition));
  const missing = [...common, ...own].filter((c) => !covered.has(c));
  const groups: Group[] = [
    { title: "Every round", rows: order(common) },
    { title: `${FAMILY_LABEL[family]} conditions`, rows: order(own) },
  ];
  if (other.length) groups.push({ title: "Outside the vocabulary", rows: other });
  return { groups, missing };
}

/**
 * The slot's branch table (spec §8.1–8.2): condition → action → what the interviewer says, with
 * notes. Conditions the invariants require but the slot doesn't cover are called out above it.
 */
export function BranchTable({ branches, roundType, label = "Branches" }: { branches: BlueprintBranch[]; roundType: string; label?: string }) {
  const { groups, missing } = groupBranches(branches, roundType);
  return (
    <div className="space-y-2">
      {missing.length ? (
        <p role="note" className="m-0 text-xs text-destructive">
          Not covered: <span className="font-mono">{missing.join(", ")}</span>
        </p>
      ) : null}
      <HairlineTable label={label} className="min-w-[720px] text-[12.5px]">
        <thead>
          <tr className="border-b border-line-2">
            <Th>Condition</Th>
            <Th>Action</Th>
            <Th>Say</Th>
            <Th>Notes</Th>
          </tr>
        </thead>
        {groups.map((g) =>
          g.rows.length ? (
            <tbody key={g.title}>
              <tr className="border-b border-line">
                <th scope="colgroup" colSpan={4} className="bg-panel px-4 py-1.5 text-left font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-faint sm:px-5">
                  {g.title} · {g.rows.length}
                </th>
              </tr>
              {g.rows.map((b, i) => (
                <Tr key={`${b.condition}-${i}`}>
                  <Td className="whitespace-nowrap py-2 align-top font-mono text-[12px]">{b.condition}</Td>
                  <Td className="whitespace-nowrap py-2 align-top font-mono text-[12px] text-muted-foreground">
                    <span aria-hidden className="mr-1 text-faint">→</span>
                    {b.action}
                  </Td>
                  <Td className="min-w-[260px] py-2 align-top leading-[1.5]">{b.say}</Td>
                  <Td className="min-w-[160px] py-2 align-top text-muted-foreground">{b.notes || "—"}</Td>
                </Tr>
              ))}
            </tbody>
          ) : null,
        )}
      </HairlineTable>
    </div>
  );
}
