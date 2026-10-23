"use client";

import { Card, EmptyState } from "@/components/ds";
import type { RoundReport } from "@/features/report";
import { MomentLink } from "./MomentLink";

/** Focus list (3-5, each with moments), then topic gaps by subject with unseen practice problems (no links: /practice has no problem route). */
export function WorkOnSection({ report }: { report: RoundReport }) {
  const focus = report.focus ?? [];
  const gaps = report.topicGaps ?? [];
  return (
    <Card flush title="Work on" meta={focus.length ? `${focus.length} ${focus.length === 1 ? "focus area" : "focus areas"}` : undefined} headerClassName="pb-4">
      {focus.length === 0 && gaps.length === 0 ? (
        <EmptyState orb={false} title="Nothing to work on" className="border-t border-line py-10" />
      ) : null}
      {focus.length > 0 ? (
        <ol className="m-0 list-none p-0">
          {focus.map((f, i) => (
            <li key={`${f.title}-${i}`} className="border-t border-line px-5 py-4">
              <p className="m-0 text-[15px]">
                <span className="mr-2.5 font-mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                {f.title}
              </p>
              <p className="m-0 mt-1.5 max-w-[68ch] text-[13.5px] leading-[1.6] text-ink-3">{f.why}</p>
              {f.exampleQuote ? (
                <div className="mt-3 max-w-[68ch] rounded-xl bg-surface-2 px-4 py-3">
                  <p className="m-0 text-[12.5px] text-ink-3">From this round, you said</p>
                  <q className="mt-1.5 block border-l-2 border-line pl-3 text-[13.5px] leading-[1.6] text-ink-2">{f.exampleQuote}</q>
                  {f.exampleNote ? <p className="m-0 mt-2 text-[13.5px] leading-[1.6]">{f.exampleNote}</p> : null}
                </div>
              ) : null}
              {f.moments.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[12.5px] text-ink-3">Moments</span>
                  {f.moments.map((m) => (
                    <MomentLink key={m} turnId={m} />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {gaps.length > 0 ? (
        <div className="border-t border-line px-5 py-5">
          <h3 className="m-0 font-mono text-xs font-normal uppercase tracking-[0.08em] text-ink-3">Topic gaps</h3>
          <ul className="m-0 mt-3 list-none space-y-5 p-0">
            {gaps.map((g) => (
              <li key={g.subject}>
                <p className="m-0 text-[14.5px]">{g.subject}</p>
                <ul className="m-0 mt-2 list-none space-y-3 p-0">
                  {g.topics.map((t) => (
                    <li key={t.topic} className="text-[13.5px] leading-[1.6]">
                      <span>{t.topic}</span>
                      <span className="text-ink-3"> · {t.why}</span>
                      {t.practice.length > 0 ? (
                        <ul className="m-0 mt-1.5 list-none space-y-1 border-l-2 border-line p-0 pl-3">
                          {t.practice.map((p) => (
                            <li key={p.slug} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                              <span>{p.title}</span>
                              {p.difficulty ? <span className="font-mono text-[11.5px] text-ink-3">{p.difficulty}</span> : null}
                              {p.retry ? <span className="font-mono text-[11.5px] text-ink">Retry this problem</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
