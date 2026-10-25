"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Chip, PageHeader } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { BETA_NOTE, levelLabel, percent } from "../constants";
import { HOW_STEPS, LEVEL_WEIGHTS, NOT_THIS, PART_GUIDE, QUICK_WINS, RULES, WEIGHT_COLUMNS } from "../explainer";
import { useProfileScore } from "../hooks";
import { RecalculateControl } from "./RecalculateControl";
import type { ProfileScoreSnapshot } from "../types";

const round1 = (n: number) => Math.round(n * 10) / 10;

type Part = ProfileScoreSnapshot["components"][number];

/** Points still available in a part: its weight minus what it contributed. */
const headroom = (p: Part) => Math.max(0, p.weight - (p.contribution ?? 0));

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <h2 id={`${id}-h`} className="m-0 font-display text-[24px] font-semibold tracking-[-0.025em] sm:text-[28px]">
        {title}
      </h2>
      {intro ? <p className="m-0 mt-2 max-w-[680px] text-[15px] leading-[1.55] text-ink-2">{intro}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function statusText(p: Part): string {
  if (p.status === "available") return "Has evidence";
  if (p.status === "pending") return "Waiting for assessment";
  return "No evidence yet, counts as 0";
}

/** One row of the breakdown: the part, its weight, your part score and what it added. */
function PartRow({ part }: { part: Part }) {
  const contribution = part.contribution ?? 0;
  const fill = part.weight > 0 ? Math.min(100, (contribution / part.weight) * 100) : 0;
  const guide = PART_GUIDE[part.id];
  return (
    <li className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_92px] sm:items-center">
      <div className="min-w-0">
        <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-medium">
          {guide?.title ?? part.label}
          {part.role ? <Chip tone="outline" className="h-5 px-2 text-xs">{part.role === "core" ? "Core" : "Extra"}</Chip> : null}
        </p>
        <p className="m-0 mt-0.5 text-[13px] text-ink-3">
          Weight {percent(part.weight)} · {statusText(part)}
        </p>
      </div>
      <div className="min-w-0">
        <div className="h-2 overflow-hidden rounded-full bg-line-2" role="img" aria-label={`${round1(contribution)} of ${round1(part.weight)} points`}>
          <div className="h-full rounded-full bg-foreground" style={{ width: `${fill}%` }} />
        </div>
        <p className="m-0 mt-1 text-xs text-ink-3">
          Part score {part.score == null ? "none yet" : `${Math.round(part.score)} / 100`}
        </p>
      </div>
      <p className="m-0 text-right font-mono text-[14px] tabular-nums sm:text-[15px]">
        {round1(contribution)}
        <span className="text-ink-3"> / {round1(part.weight)}</span>
      </p>
    </li>
  );
}

function YourScore({ current, level }: { current: ProfileScoreSnapshot | null | undefined; level: string | undefined }) {
  const parts = [...(current?.components ?? [])].filter((p) => p.weight > 0).sort((a, b) => b.weight - a.weight);
  const score = current?.score ?? null;
  return (
    <div className="iq-glass-card p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="m-0 text-[13px] text-ink-3">Your profile score</p>
          <p className="m-0 mt-1 font-display text-[56px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
            {score == null ? "—" : round1(score)}
            {score != null ? <span className="text-[20px] font-medium text-ink-3"> / 100</span> : null}
          </p>
        </div>
        <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3 text-[13px]">
          <div>
            <dt className="text-ink-3">Scored for level</dt>
            <dd className="m-0 mt-0.5 text-[15px]">{levelLabel(current?.level ?? (level as never))}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Coverage</dt>
            <dd className="m-0 mt-0.5 font-mono text-[15px] tabular-nums">{current ? percent(current.coverage) : "—"}</dd>
          </div>
        </dl>
      </div>

      {score == null ? (
        <p className="m-0 mt-5 max-w-[640px] rounded-2xl bg-surface px-4 py-3.5 text-[14px] leading-[1.55] text-ink-2">
          There is no score yet. A score needs evidence in at least one core part for your level. Connect your resume and a
          coding platform or GitHub, then recalculate. This is not a zero.
        </p>
      ) : (
        <p className="m-0 mt-5 max-w-[680px] text-[14px] leading-[1.6] text-ink-2">
          Your score is the sum of what each part below added. A part adds its weight × its part score ÷ 100, and a part with no
          evidence adds 0. <span className="text-foreground">Coverage</span>{" "}
          is the share of your level&apos;s core weight that has evidence: it explains the score and does not change it.
        </p>
      )}

      {parts.length ? (
        <ul className="m-0 mt-4 list-none divide-y divide-line p-0 border-t border-line">
          {parts.map((p) => (
            <PartRow key={p.id} part={p} />
          ))}
          <li className="flex items-center justify-between gap-3 py-4 text-[15px] font-semibold">
            <span>Total</span>
            <span className="font-mono tabular-nums">{score == null ? "—" : `${round1(score)} / 100`}</span>
          </li>
        </ul>
      ) : null}

      {current && [...current.warnings, ...current.eligibility.reasons].length ? (
        <details className="mt-2 border-t border-line pt-4">
          <summary className="cursor-pointer select-none text-[13px] font-medium hover:text-ink-2">Notes from your last calculation</summary>
          <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-[13px] leading-[1.5] text-ink-2">
            {[...new Set([...current.warnings, ...current.eligibility.reasons])].map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <RecalculateControl label="Recalculate" refresh={false} />
        <p className="m-0 text-xs text-ink-3">
          {current ? `Last calculated ${new Date(current.calculatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. ` : ""}
          Scores also refresh weekly. Recalculate re-assesses new or changed projects and experience.
        </p>
      </div>
    </div>
  );
}

function Lift({ current }: { current: ProfileScoreSnapshot | null | undefined }) {
  const gains = [...(current?.components ?? [])]
    .filter((p) => p.weight > 0 && headroom(p) >= 0.5)
    .sort((a, b) => headroom(b) - headroom(a))
    .slice(0, 4);
  return (
    <div className="flex flex-col gap-10">
      {gains.length ? (
        <div>
          <h3 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">Where you can gain the most</h3>
          <p className="m-0 mt-1.5 max-w-[640px] text-[14px] leading-[1.55] text-ink-2">
            These parts have the most points left at your level. Gains are not guaranteed: a part is scored from the evidence your
            sources actually show.
          </p>
          <ol className="m-0 mt-5 grid list-none gap-4 p-0 md:grid-cols-2">
            {gains.map((p) => {
              const guide = PART_GUIDE[p.id];
              return (
                <li key={p.id} className="iq-glass-card p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{guide?.title ?? p.label}</p>
                    <p className="m-0 flex-none font-mono text-[13px] tabular-nums text-ink-3">up to +{round1(headroom(p))} pts</p>
                  </div>
                  {guide ? (
                    <ul className="m-0 mt-3 list-disc space-y-1.5 pl-5 text-[14px] leading-[1.5] text-ink-2">
                      {guide.lift.slice(0, 3).map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <div>
        <h3 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">Four things that help everyone</h3>
        <ul className="m-0 mt-5 grid list-none gap-4 p-0 sm:grid-cols-2">
          {QUICK_WINS.map((q) => (
            <li key={q.title} className="flex flex-col rounded-[22px] bg-surface p-5">
              <p className="m-0 text-[15px] font-semibold">{q.title}</p>
              <p className="m-0 mt-1.5 flex-1 text-[14px] leading-[1.55] text-ink-2">{q.body}</p>
              <Link
                href={q.href}
                className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-md text-[14px] font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {q.cta}
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Parts({ current }: { current: ProfileScoreSnapshot | null | undefined }) {
  const ids = current?.components.length ? current.components.filter((p) => p.weight > 0).sort((a, b) => b.weight - a.weight).map((p) => p.id) : Object.keys(PART_GUIDE);
  const list = ids.map((id) => PART_GUIDE[id]).filter(Boolean);
  return (
    <div className="flex flex-col gap-2.5">
      {list.map((g) => (
        <details key={g.title} className="group iq-glass-card px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md text-[16px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {g.title}
            <span aria-hidden className="text-ink-3 transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <dl className="m-0 mt-4 grid gap-4 text-[14px] leading-[1.55] sm:grid-cols-2">
            <div>
              <dt className="text-[13px] text-ink-3">What it looks at</dt>
              <dd className="m-0 mt-1">{g.measures}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-3">Where it comes from</dt>
              <dd className="m-0 mt-1">{g.from}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[13px] text-ink-3">How to raise it</dt>
              <dd className="m-0 mt-1">
                <ul className="m-0 list-disc space-y-1 pl-5">
                  {g.lift.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </details>
      ))}
    </div>
  );
}

function Weights({ level }: { level: string | undefined }) {
  const rows = Object.entries(LEVEL_WEIGHTS);
  return (
    <>
      {/* Phones: one card per level, since eight columns do not fit. */}
      <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
        {rows.map(([lv, w]) => (
          <li key={lv} className={cn("rounded-2xl p-4", lv === level ? "iq-glass-card" : "bg-surface")}>
            <p className="m-0 flex items-center gap-2 text-[15px] font-semibold">
              {levelLabel(lv as never)}
              {lv === level ? <Chip tone="outline" className="h-5 px-2 text-xs">Your level</Chip> : null}
            </p>
            <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              {WEIGHT_COLUMNS.map((c, i) => (
                <div key={c} className="flex justify-between gap-2">
                  <dt className="text-ink-3">{c}</dt>
                  <dd className="m-0 font-mono tabular-nums">{w[i]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-[22px] bg-card shadow-ring md:block">
        <table className="w-full border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-line text-[12.5px] text-ink-3">
              <th scope="col" className="px-5 py-3.5 font-medium">Level</th>
              {WEIGHT_COLUMNS.map((c) => (
                <th key={c} scope="col" className="px-3 py-3.5 text-right font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([lv, w]) => (
              <tr key={lv} className={cn("border-b border-line last:border-b-0", lv === level && "bg-foreground/[0.05] font-medium")}>
                <th scope="row" className="px-5 py-3 font-medium">
                  {levelLabel(lv as never)}
                  {lv === level ? <span className="ml-2 text-xs font-normal text-ink-3">your level</span> : null}
                </th>
                {w.map((v, i) => (
                  <td key={WEIGHT_COLUMNS[i]} className="px-3 py-3 text-right font-mono tabular-nums">{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** "How your profile score works": why you scored what you did, how it is calculated and how to lift it. */
export function ScoreExplainer() {
  const query = useProfileScore();
  const current = query.data?.current;
  const level = current?.level ?? query.data?.settings.declaredLevel ?? undefined;
  return (
    <div className="flex flex-col gap-14 sm:gap-16">
      <div className="flex flex-col gap-6">
        <Link
          href="/profile"
          className="inline-flex w-fit items-center gap-1.5 rounded-md text-[14px] text-ink-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Profile
        </Link>
        <PageHeader
          title="How your profile score works"
          description="Why your score is what it is, exactly how it is calculated, and what you can do to raise it."
        />
        <p className="m-0 max-w-[680px] text-[13px] leading-[1.5] text-ink-3">{BETA_NOTE}</p>
        <nav aria-label="On this page" className="flex flex-wrap gap-2">
          {[
            ["#your-score", "Your score"],
            ["#how", "How it is calculated"],
            ["#lift", "How to raise it"],
            ["#parts", "Each part"],
            ["#levels", "Weights by level"],
            ["#limits", "What it is not"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="iq-glass-btn inline-flex h-9 items-center rounded-full px-3.5 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-brand">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <Section id="your-score" title="Why your score is what it is">
        {query.isLoading ? (
          <Skeleton className="h-72 w-full rounded-[24px]" />
        ) : query.isError ? (
          <div role="alert" className="rounded-2xl bg-surface p-5 text-[14px]">
            We could not load your score.{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <YourScore current={current} level={level} />
        )}
      </Section>

      <Section id="how" title="How it is calculated" intro="Five steps, the same for everyone. Only the weights change with your level.">
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
          {HOW_STEPS.map((s, i) => (
            <li key={s.title} className="iq-glass-card flex gap-4 p-5 md:last:col-span-2">
              <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-full bg-foreground text-[14px] font-semibold text-background">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{s.title}</p>
                <p className="m-0 mt-1.5 text-[14px] leading-[1.55] text-ink-2">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <h3 className="m-0 mt-10 text-[17px] font-semibold tracking-[-0.01em]">Rules that shape the result</h3>
        <ul className="m-0 mt-4 grid list-none gap-x-8 gap-y-5 p-0 md:grid-cols-2">
          {RULES.map((r) => (
            <li key={r.title} className="border-t border-line-2 pt-4">
              <p className="m-0 text-[15px] font-medium">{r.title}</p>
              <p className="m-0 mt-1 text-[14px] leading-[1.55] text-ink-2">{r.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="lift" title="How to raise it" intro="Do these in order: add missing evidence first, then make what is there more specific.">
        <Lift current={current} />
      </Section>

      <Section id="parts" title="What each part looks at" intro="Open a part to see what it measures, where its evidence comes from and how to raise it.">
        <Parts current={current} />
      </Section>

      <Section id="levels" title="Weights by level" intro="Every row adds up to 100. The weight is how much a person at that level is expected to show in that part.">
        <Weights level={level} />
        <p className="m-0 mt-4 max-w-[680px] text-[13px] leading-[1.55] text-ink-3">
          Engineering scope groups implementation, ownership, impact, architecture, cross-team influence and strategy; the parts
          that count at each level are shown in your breakdown above. Weights are a provisional beta setting and can change.
        </p>
      </Section>

      <Section id="limits" title="What it is not">
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
          {NOT_THIS.map((t) => (
            <li key={t} className="rounded-2xl bg-surface px-5 py-4 text-[14px] leading-[1.55] text-ink-2">
              {t}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
