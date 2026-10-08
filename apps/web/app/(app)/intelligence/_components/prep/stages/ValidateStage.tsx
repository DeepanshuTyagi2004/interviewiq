"use client";

import type { BlueprintStage, InvariantCheck } from "@/features/blueprints";
import { isRecord } from "../format";
import { Facts, PassMark, Section } from "../ui";

/** The untyped `detail.checks` payload, as invariant checks (spec §8.3). */
function checksOf(stage: BlueprintStage): InvariantCheck[] {
  const raw = stage.detail?.checks;
  return Array.isArray(raw)
    ? raw.filter(isRecord).map((c) => ({ check: String(c.check ?? ""), passed: c.passed === true, detail: String(c.detail ?? "") }))
    : [];
}

/** Stage 8: every invariant, pass or fail, with the reason. */
export function ValidateStage({ stage }: { stage: BlueprintStage }) {
  const checks = checksOf(stage);
  const failed = checks.filter((c) => !c.passed).length;
  const s = stage.summary ?? {};
  return (
    <div className="space-y-5">
      <Section title="Summary">
        <Facts
          items={[
            ["Checks", `${checks.length} · ${failed} failed`],
            ["Saved as", typeof s.version === "number" ? `version ${s.version}` : s.bench ? "bench (not saved to a session)" : "—"],
          ]}
        />
      </Section>
      <Section title="Invariants">
        {checks.length === 0 ? (
          <p className="m-0 text-xs text-faint">No checks recorded.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-line rounded-[12px] border border-line-2 p-0">
            {checks.map((c, i) => (
              <li key={`${c.check}-${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
                <PassMark ok={c.passed} yes="pass" no="fail" />
                <span className="font-mono text-[12.5px]">{c.check}</span>
                {c.detail ? <span className="w-full text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">{c.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
