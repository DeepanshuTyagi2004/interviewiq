"use client";

import { MonoPill } from "@/components/patterns";
import { asRecords, asString, asStrings, isRecord } from "../format";
import { Lines, MonoBlock, Section } from "../ui";

const KNOWN = new Set([
  "approaches", "complexity_target", "key_insights", "common_wrong_paths", "edge_cases", "reference_solution", "must_cover", "base",
]);

const pretty = (key: string) => key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * One answer key, readable (spec §6 stage 3). DSA keys carry approaches, a complexity target, insights,
 * wrong paths, edge cases and a sandbox-checked reference solution; design and behavioural keys carry
 * the bank's own expected content (`base`) plus must-cover points, insights, wrong paths and edge cases.
 */
export function AnswerKeyView({ answerKey }: { answerKey: Record<string, unknown> | null | undefined }) {
  if (!answerKey || Object.keys(answerKey).length === 0) {
    return <p className="m-0 text-xs text-faint">No answer key recorded.</p>;
  }
  const approaches = asRecords(answerKey.approaches);
  const complexity = asString(answerKey.complexity_target);
  const insights = asStrings(answerKey.key_insights);
  const wrongPaths = asRecords(answerKey.common_wrong_paths);
  const edgeCases = asStrings(answerKey.edge_cases);
  const mustCover = asStrings(answerKey.must_cover);
  const solution = isRecord(answerKey.reference_solution) ? answerKey.reference_solution : null;
  const base = isRecord(answerKey.base) ? answerKey.base : null;
  const rest = Object.entries(answerKey).filter(([k]) => !KNOWN.has(k));

  return (
    <div className="space-y-4">
      {approaches.length ? (
        <Section title="Approaches (brute force → optimal)">
          <ol className="m-0 space-y-1.5 pl-5 text-[13px] leading-[1.5]">
            {approaches.map((a, i) => (
              <li key={i}>
                <span>{asString(a.name) ?? `Approach ${i + 1}`}</span>
                {asString(a.idea) ? <span className="text-muted-foreground"> · {asString(a.idea)}</span> : null}
                <span className="block font-mono text-[11.5px] text-faint">
                  time {asString(a.time_complexity) ?? "—"} · space {asString(a.space_complexity) ?? "—"}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
      {complexity ? (
        <Section title="Complexity target">
          <p className="m-0 font-mono text-[12.5px]">{complexity}</p>
        </Section>
      ) : null}
      {base ? <BaseContent base={base} /> : null}
      {mustCover.length ? <Section title="Must cover"><Lines items={mustCover} /></Section> : null}
      {insights.length ? <Section title="Key insights"><Lines items={insights} /></Section> : null}
      {wrongPaths.length ? (
        <Section title="Common wrong paths">
          <ul className="m-0 space-y-2 pl-5 text-[13px] leading-[1.5]">
            {wrongPaths.map((w, i) => (
              <li key={i}>
                <span>{asString(w.path) ?? "—"}</span>
                {asString(w.why_wrong) ? <span className="block text-muted-foreground">Why wrong: {asString(w.why_wrong)}</span> : null}
                {asString(w.nudge) ? <span className="block text-muted-foreground">Nudge: {asString(w.nudge)}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {edgeCases.length ? <Section title="Edge cases"><Lines items={edgeCases} /></Section> : null}
      {solution ? <Solution solution={solution} /> : null}
      {rest.length ? (
        <Section title="Other fields">
          <MonoBlock label="Other answer-key fields" text={JSON.stringify(Object.fromEntries(rest), null, 2)} copy={false} />
        </Section>
      ) : null}
    </div>
  );
}

function Solution({ solution }: { solution: Record<string, unknown> }) {
  const verified = solution.verified_against_examples === true;
  const code = asString(solution.code) ?? "";
  return (
    <Section
      title={`Reference solution · ${asString(solution.language) ?? "python"}${asString(solution.entry_point) ? ` · ${asString(solution.entry_point)}` : ""}`}
      action={<MonoPill tone={verified ? "ink" : "alert"}>{verified ? "verified against examples" : "not verified"}</MonoPill>}
    >
      <MonoBlock label="Reference solution" text={code} />
    </Section>
  );
}

/** The bank's own expected design / strong answer, field by field. */
function BaseContent({ base }: { base: Record<string, unknown> }) {
  const entries = Object.entries(base);
  if (!entries.length) return null;
  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => (
        <Section key={key} title={`From the bank · ${pretty(key)}`}>
          {typeof value === "string" ? (
            <p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.5]">{value}</p>
          ) : Array.isArray(value) && value.every((v) => typeof v === "string") ? (
            <Lines items={value as string[]} />
          ) : (
            <MonoBlock label={pretty(key)} text={JSON.stringify(value, null, 2)} copy={false} />
          )}
        </Section>
      ))}
    </div>
  );
}
