"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { MonoPill } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import {
  useProblemBank, useQuestionBankStats, useScrapeStatus, useTriggerCollect, useTriggerQuestionGeneration,
  type BehaviouralContent, type DsaContent, type LldContent, type QuestionContentStatus, type QuestionRecord, type SystemDesignContent,
} from "@/features/intelligence";
import { cn } from "@/lib/utils/cn";

const ROUNDS = ["dsa", "online-assessment", "system-design", "lld", "behavioural", "hiring-manager"] as const;
const STATUSES: QuestionContentStatus[] = ["none", "generated", "verified", "failed"];
const ROUND_LABEL: Record<(typeof ROUNDS)[number], string> = {
  "dsa": "DSA", "online-assessment": "Online assessment", "system-design": "System design", "lld": "LLD", "behavioural": "Behavioural", "hiring-manager": "Hiring manager",
};
const STATUS_TONE: Record<QuestionContentStatus, string> = {
  none: "text-faint", generated: "text-foreground", verified: "text-brand", failed: "text-destructive",
};

const field = "h-8 rounded-full border border-line-4 bg-card px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="iq-eyebrow m-0">{title}</h4>
      {children}
    </section>
  );
}

function Lines({ items }: { items: string[] | undefined }) {
  if (!items?.length) return <p className="m-0 text-xs text-faint">—</p>;
  return <ul className="m-0 list-disc space-y-1 pl-5 text-[13px] leading-[1.5]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

function Rubric({ items }: { items: { criterion: string; weight: number; strong: string; weak: string }[] }) {
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead><tr className="text-left text-faint"><th className="py-1 pr-3 font-normal">Criterion</th><th className="py-1 pr-3 font-normal">Weight</th><th className="py-1 pr-3 font-normal">Strong</th><th className="py-1 font-normal">Weak</th></tr></thead>
      <tbody>{items.map((r) => <tr key={r.criterion} className="border-t border-line-2 align-top"><td className="py-1.5 pr-3">{r.criterion}</td><td className="py-1.5 pr-3 font-mono tabular-nums">{r.weight}</td><td className="py-1.5 pr-3 text-muted-foreground">{r.strong}</td><td className="py-1.5 text-muted-foreground">{r.weak}</td></tr>)}</tbody>
    </table>
  );
}

const code = (v: unknown) => JSON.stringify(v);

function DsaView({ c }: { c: DsaContent }) {
  return (
    <div className="space-y-4">
      <Section title="Statement"><p className="m-0 whitespace-pre-wrap text-[13.5px] leading-[1.55]">{c.statement}</p></Section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Input"><p className="m-0 text-[13px]">{c.input_format}</p></Section>
        <Section title="Output"><p className="m-0 text-[13px]">{c.output_format}</p></Section>
      </div>
      <Section title="Constraints"><Lines items={c.constraints} /></Section>
      <Section title={`Examples (${c.examples.length})`}>
        <ol className="m-0 space-y-2 pl-5 text-[13px]">
          {c.examples.map((e, i) => <li key={i}><span className="font-mono text-[12px]">{code(e.args)} → {code(e.expected)}</span><span className="block text-muted-foreground">{e.explanation}</span></li>)}
        </ol>
      </Section>
      {c.judge_tests?.length ? <Section title={`Hidden judge tests (${c.judge_tests.length})`}><ul className="m-0 list-none space-y-1 p-0 font-mono text-[12px]">{c.judge_tests.map((t, i) => <li key={i}>{code(t.args)} → {code(t.expected)}</li>)}</ul></Section> : null}
      <Section title="Hints (gentle → explicit)"><Lines items={c.hints} /></Section>
      {c.approaches?.length ? <Section title="Approaches"><Lines items={c.approaches.map((a) => `${a.name}: ${a.idea} — ${a.time_complexity} time, ${a.space_complexity} space`)} /></Section> : null}
      <Section title="Follow-ups"><Lines items={c.follow_ups} /></Section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Edge cases"><Lines items={c.edge_cases} /></Section>
        <Section title="Common mistakes"><Lines items={c.common_mistakes} /></Section>
      </div>
      {c.rubric?.length ? <Section title="Rubric"><Rubric items={c.rubric} /></Section> : null}
      {c.reference_solution ? (
        <Section title={`Reference solution · ${c.reference_solution.language} · ${c.reference_solution.entry_point}`}>
          <pre className="m-0 overflow-x-auto rounded-[10px] border border-line-2 bg-panel p-3 font-mono text-[12px] leading-[1.5]">{c.reference_solution.code}</pre>
        </Section>
      ) : <p className="m-0 text-xs text-faint">Solution and answer analysis are built at round-preparation time.</p>}
    </div>
  );
}

function SystemDesignView({ c }: { c: SystemDesignContent }) {
  return (
    <div className="space-y-4">
      <Section title="Prompt"><p className="m-0 text-[13.5px] leading-[1.55]">{c.prompt}</p></Section>
      <Section title="Clarifying questions a strong candidate asks"><Lines items={c.clarifying_questions} /></Section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Functional requirements"><Lines items={c.functional_requirements} /></Section>
        <Section title="Non-functional requirements"><Lines items={c.non_functional_requirements} /></Section>
      </div>
      <Section title="Scale assumptions"><Lines items={c.scale_assumptions} /></Section>
      <Section title="Expected design">
        <Lines items={c.expected_design.components.map((x) => `${x.name}: ${x.purpose}`)} />
        <p className="m-0 mt-2 text-[13px]"><span className="text-faint">Data model · </span>{c.expected_design.data_model}</p>
        <p className="m-0 mt-1 text-[13px]"><span className="text-faint">Data flow · </span>{c.expected_design.data_flow}</p>
        {c.expected_design.api_sketch?.length ? <ul className="m-0 mt-2 list-none p-0 font-mono text-[12px]">{c.expected_design.api_sketch.map((a) => <li key={a}>{a}</li>)}</ul> : null}
      </Section>
      <Section title="Deep dives"><Lines items={c.deep_dives} /></Section>
      <Section title="Trade-offs"><Lines items={c.trade_offs.map((t) => `${t.decision}: ${t.options.join(" vs ")} → ${t.recommendation}`)} /></Section>
      <Section title="Follow-ups"><Lines items={c.follow_ups} /></Section>
      <Section title="Red flags"><Lines items={c.red_flags} /></Section>
      <Section title="Rubric"><Rubric items={c.rubric} /></Section>
      <Section title="What a strong answer covers"><p className="m-0 text-[13px] leading-[1.5]">{c.strong_answer_summary}</p></Section>
    </div>
  );
}

function LldView({ c }: { c: LldContent }) {
  return (
    <div className="space-y-4">
      <Section title={`Prompt · ${c.evaluation_mode}`}><p className="m-0 text-[13.5px] leading-[1.55]">{c.prompt}</p></Section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Requirements"><Lines items={c.requirements} /></Section>
        <Section title="Entities"><Lines items={c.entities} /></Section>
      </div>
      <Section title="Expected design">
        <Lines items={c.expected_design.classes.map((k) => `${k.name}: ${k.responsibilities}${k.key_methods?.length ? ` (${k.key_methods.join(", ")})` : ""}`)} />
        {c.expected_design.relationships?.length ? <p className="m-0 mt-2 text-[13px]"><span className="text-faint">Relationships · </span>{c.expected_design.relationships.join("; ")}</p> : null}
        {c.expected_design.patterns?.length ? <p className="m-0 mt-1 text-[13px]"><span className="text-faint">Patterns · </span>{c.expected_design.patterns.join(", ")}</p> : null}
      </Section>
      {c.sample_api?.length ? <Section title="Sample API"><ul className="m-0 list-none p-0 font-mono text-[12px]">{c.sample_api.map((a) => <li key={a}>{a}</li>)}</ul></Section> : null}
      <Section title="Follow-ups"><Lines items={c.follow_ups} /></Section>
      <Section title="Red flags"><Lines items={c.red_flags} /></Section>
      <Section title="Rubric"><Rubric items={c.rubric} /></Section>
      <Section title="What a strong answer looks like"><p className="m-0 text-[13px] leading-[1.5]">{c.strong_answer_summary}</p></Section>
    </div>
  );
}

function BehaviouralView({ c }: { c: BehaviouralContent }) {
  return (
    <div className="space-y-4">
      <Section title={`Question · ${c.competency}`}><p className="m-0 text-[13.5px] leading-[1.55]">{c.question}</p></Section>
      <Section title="STAR guide"><Lines items={[`Situation: ${c.star_guide.situation}`, `Task: ${c.star_guide.task}`, `Action: ${c.star_guide.action}`, `Result: ${c.star_guide.result}`]} /></Section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Strong answer"><p className="m-0 text-[13px] leading-[1.5]">{c.strong_answer_summary}</p></Section>
        <Section title="Weak answer"><p className="m-0 text-[13px] leading-[1.5] text-muted-foreground">{c.weak_answer_summary}</p></Section>
      </div>
      <Section title="Follow-up probes"><Lines items={c.follow_up_probes} /></Section>
      <Section title="Red flags"><Lines items={c.red_flags} /></Section>
      {c.principle ? <Section title="Principle"><p className="m-0 text-[13px]">{c.principle}</p></Section> : null}
      {c.deep_dive_guidance ? <Section title="Project deep-dive"><p className="m-0 text-[13px] leading-[1.5]">{c.deep_dive_guidance}</p></Section> : null}
    </div>
  );
}

/** One problem's content, by round type. */
export function ProblemContent({ q }: { q: QuestionRecord }) {
  if (!q.content) return <p className="m-0 text-sm text-muted-foreground">{q.content_status === "failed" ? `Generation failed: ${q.content_error ?? "unknown error"}` : "No content generated yet."}</p>;
  const c = q.content;
  const view = q.round_type === "system-design" ? <SystemDesignView c={c as SystemDesignContent} />
    : q.round_type === "lld" ? <LldView c={c as LldContent} />
    : q.round_type === "behavioural" || q.round_type === "hiring-manager" ? <BehaviouralView c={c as BehaviouralContent} />
    : <DsaView c={c as DsaContent} />;
  return (
    <div className="space-y-3">
      <p className="m-0 text-xs text-faint">
        {"what_it_tests" in c ? `Tests: ${c.what_it_tests} · ` : ""}{"estimated_minutes" in c ? `${c.estimated_minutes} min · ` : ""}
        {q.content_status}{q.content_error ? ` · ${q.content_error}` : ""}{q.content_model ? ` · ${q.content_model}` : ""}
      </p>
      {view}
    </div>
  );
}

/** Admin: the problem bank's size by round and status, the collect/generate controls, and a browsable list. */
export function ProblemBankTab() {
  const stats = useQuestionBankStats({ refetchIntervalMs: 5000 });
  const run = useScrapeStatus();
  const collect = useTriggerCollect();
  const generate = useTriggerQuestionGeneration();
  const [genRound, setGenRound] = useState("");
  const [genLimit, setGenLimit] = useState("25");
  const [force, setForce] = useState(false);
  const [filters, setFilters] = useState({ roundType: "", contentStatus: "", topic: "", company: "" });
  const [open, setOpen] = useState<string | null>(null);
  const bank = useProblemBank({ roundType: filters.roundType || undefined, contentStatus: filters.contentStatus || undefined, topic: filters.topic || undefined, company: filters.company || undefined, limit: 50 });
  const running = run.data?.status === "running";
  const contentStage = run.data?.stages?.question_content as Record<string, number> | undefined;
  const rows = useMemo(() => ROUNDS.filter((r) => stats.data?.rounds[r]).map((r) => ({ round: r, counts: stats.data!.rounds[r]! })), [stats.data]);

  return (
    <div className="space-y-4">
      <ConsoleCard title="Problem bank" meta={<HeaderCount>{stats.data ? `${stats.data.total} problems` : "…"}</HeaderCount>} bodyClassName="p-4 sm:p-5">
        {rows.length ? (
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="text-left text-faint"><th className="py-1 pr-3 font-normal">Round</th>{STATUSES.map((s) => <th key={s} className="py-1 pr-3 text-right font-normal">{s}</th>)}<th className="py-1 text-right font-normal">total</th></tr></thead>
            <tbody>
              {rows.map(({ round, counts }) => (
                <tr key={round} className="border-t border-line-2">
                  <td className="py-1.5 pr-3">{ROUND_LABEL[round]}</td>
                  {STATUSES.map((s) => <td key={s} className={cn("py-1.5 pr-3 text-right font-mono tabular-nums", STATUS_TONE[s])}>{counts[s] ?? 0}</td>)}
                  <td className="py-1.5 text-right font-mono tabular-nums">{Object.values(counts).reduce((a, b) => a + b, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="m-0 text-sm text-muted-foreground">{stats.isLoading ? "Loading…" : "The index is empty. Collect it, or generate: generation collects first when the index is empty."}</p>}
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line-2 pt-4">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">Round
            <select aria-label="Generate round" className={field} value={genRound} onChange={(e) => setGenRound(e.target.value)} disabled={running}>
              <option value="">All rounds</option>{ROUNDS.map((r) => <option key={r} value={r}>{ROUND_LABEL[r]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">Limit
            <input aria-label="Generate limit" type="number" min={1} className={cn(field, "w-24")} value={genLimit} onChange={(e) => setGenLimit(e.target.value)} disabled={running} />
          </label>
          <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" className="h-4 w-4 accent-brand" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={running} />Regenerate current</label>
          <Button type="button" variant="outline" size="sm" disabled={running || collect.isPending} onClick={() => collect.mutate()}>Collect index</Button>
          <Button type="button" size="sm" disabled={running || generate.isPending} onClick={() => generate.mutate({ roundType: genRound || undefined, limit: Math.max(1, Number(genLimit) || 25), force })}>Generate content</Button>
          <p className="m-0 w-full text-xs text-faint" aria-live="polite">
            {running ? `Running · ${run.data?.stage ?? "…"}` : run.data?.status ? `Last run ${run.data.status}` : ""}
            {contentStage ? ` · candidates ${contentStage.candidates ?? 0}, verified ${contentStage.verified ?? 0}, generated ${contentStage.generated ?? 0}, unverified ${contentStage.unverified ?? 0}, failed ${contentStage.failed ?? 0}` : ""}
            {run.data?.error ? ` · ${run.data.error}` : ""}
          </p>
        </div>
      </ConsoleCard>

      <ConsoleCard title="Browse" meta={<HeaderCount>{bank.data ? `${bank.data.returned ?? bank.data.questions.length} of ${bank.data.count}` : "…"}</HeaderCount>} bodyClassName="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Filter round" className={field} value={filters.roundType} onChange={(e) => setFilters((f) => ({ ...f, roundType: e.target.value }))}><option value="">Any round</option>{ROUNDS.map((r) => <option key={r} value={r}>{ROUND_LABEL[r]}</option>)}</select>
          <select aria-label="Filter status" className={field} value={filters.contentStatus} onChange={(e) => setFilters((f) => ({ ...f, contentStatus: e.target.value }))}><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <input aria-label="Filter topic" placeholder="Topic" className={cn(field, "w-40")} value={filters.topic} onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value }))} />
          <input aria-label="Filter company" placeholder="Company slug" className={cn(field, "w-40")} value={filters.company} onChange={(e) => setFilters((f) => ({ ...f, company: e.target.value }))} />
        </div>
        {bank.isError ? <p role="alert" className="m-0 mt-3 text-sm text-destructive">Couldn&apos;t load the bank.</p> : null}
        <ul className="m-0 mt-3 list-none divide-y divide-line-2 p-0">
          {(bank.data?.questions ?? []).map((q) => {
            const key = `${q.round_type}/${q.slug}`;
            const isOpen = open === key;
            return (
              <li key={key} className="py-2">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <span className="min-w-0 flex-1 text-[13.5px]">{q.title}</span>
                  <MonoPill>{ROUND_LABEL[q.round_type as (typeof ROUNDS)[number]] ?? q.round_type}</MonoPill>
                  {q.difficulty ? <MonoPill>{q.difficulty}</MonoPill> : null}
                  <span className={cn("font-mono text-[11px]", STATUS_TONE[q.content_status])}>{q.content_status}</span>
                  <span className="block w-full truncate text-xs text-faint">
                    {q.company_tags.map((c) => `${c}${q.company_evidence?.[c] === "inferred" ? "?" : ""}`).join(", ") || "no company"} · {q.topic_tags.slice(0, 6).join(", ") || "no topics"}
                  </span>
                </button>
                {isOpen ? <div className="mt-3 rounded-[12px] border border-line-2 p-4"><ProblemContent q={q} /></div> : null}
              </li>
            );
          })}
        </ul>
        {bank.data && !bank.data.questions.length ? <p className="m-0 mt-3 text-sm text-muted-foreground">Nothing matches.</p> : null}
      </ConsoleCard>
    </div>
  );
}
