import * as React from "react";
import { Count, HudCard, HudEmpty, padCount } from "@/components/hud";
import type { JdDetail } from "@/features/jobs";
import { plural } from "@/app/(app)/jobs/_components/library";
import { cn } from "@/lib/utils/cn";
import { groupSources } from "./insights";
import { isAdminVerifiedProcess, topicRows } from "./rounds";

/** One insight: a HUD card whose mono header is the eyebrow (named by it), with an optional count. */
function InsightCard({
  eyebrow,
  meta,
  children,
  className,
}: {
  eyebrow: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <HudCard title={eyebrow} titleAs="h3" meta={meta} className={className} bodyClassName="flex flex-col gap-3 p-4 sm:p-5">
      {children}
    </HudCard>
  );
}

const linkClass =
  "rounded-sm underline-offset-[3px] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * What the brief says about this JD: dominant topics (cross-referenced to rounds, no invented
 * percentages), interviewer style, red flags, difficulty, company patterns, the sources behind it,
 * and the JD itself.
 */
export function InsightsTab({ jd }: { jd: JdDetail }) {
  const p = jd.interviewProcess;
  const topics = topicRows(p);
  const style = p?.interviewer_style_notes?.trim();
  const flags = (p?.red_flags ?? []).map((f) => f.trim()).filter(Boolean);
  const difficulty = p?.difficulty_calibration?.trim();
  const publishedCompanyText = jd.companyOverview ? [jd.companyOverview.overview, jd.companyOverview.culture, jd.companyOverview.benefits].filter(Boolean).join("\n\n").trim() : null;
  const patterns = jd.practiceTemplate || p?.company_specific_patterns?.trim() === publishedCompanyText ? null : p?.company_specific_patterns?.trim();
  const sources = jd.practiceTemplate ? [] : groupSources(jd.sources);
  const sourceCount = sources.reduce((n, s) => n + s.urls.length, 0);
  const description = jd.description?.trim();
  const hasAbout = Boolean(description || jd.techStack.length > 0 || jd.sourceUrl);

  if (topics.length === 0 && !style && flags.length === 0 && !difficulty && !patterns && sources.length === 0 && !hasAbout) {
    return (
      <HudCard as="div">
        <HudEmpty
          title="No insights yet"
          hint="Topics, interviewer style and red flags appear once this role's interview process has been researched."
        />
      </HudCard>
    );
  }

  const leftColumn = topics.length > 0 || difficulty;
  const middleColumn = style || flags.length > 0 || patterns;

  return (
    <div className="flex flex-col gap-3">
      {jd.practiceTemplate ? <p className="m-0 rounded-xl border border-line-3 p-4 text-sm text-muted-foreground">Practice template · simulated topics and guidance, not company interview research.</p> : null}
      <div className="grid items-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
        {leftColumn ? (
          <div className="flex min-w-0 flex-col gap-3">
            {topics.length > 0 ? (
              <InsightCard eyebrow={jd.practiceTemplate ? "Practice topics" : isAdminVerifiedProcess(p) ? "Interview topics" : "Most-asked topics"}>
                <ul className="m-0 list-none p-0">
                  {topics.map((t) => (
                    <li key={t.topic} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-[13.5px] last:border-b-0">
                      <span className="min-w-0">{t.topic}</span>
                      {t.rounds.length > 0 ? (
                        <span className="flex-none font-mono text-[11.5px] tabular-nums text-faint">
                           <span className="sr-only">{jd.practiceTemplate ? "Practised" : "Asked"} in round {t.rounds.join(", ")}</span>
                          <span aria-hidden>{t.rounds.map((n) => `R${padCount(n)}`).join(" · ")}</span>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {topics.some((t) => t.rounds.length > 0) ? (
                  <p className="m-0 text-xs text-faint">R01, R02… are the rounds that list the topic.</p>
                ) : null}
              </InsightCard>
            ) : null}
            {difficulty ? (
              <InsightCard eyebrow="Difficulty">
                <p className="m-0 text-sm leading-[1.5]">{difficulty}</p>
              </InsightCard>
            ) : null}
          </div>
        ) : null}

        {middleColumn ? (
          <div className="flex min-w-0 flex-col gap-3">
            {style ? (
              <InsightCard eyebrow={jd.practiceTemplate ? "Interviewer guidance" : "Interviewer style"}>
                <p className="m-0 text-[15px] leading-[1.5]">{style}</p>
              </InsightCard>
            ) : null}
            {flags.length > 0 ? (
              <InsightCard eyebrow="Red flags">
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {flags.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[13.5px] leading-[1.45]">
                      <span aria-hidden className="text-faint">
                        !
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </InsightCard>
            ) : null}
            {patterns ? (
              <InsightCard eyebrow="Company patterns">
                <p className="m-0 text-sm leading-[1.5]">{patterns}</p>
              </InsightCard>
            ) : null}
          </div>
        ) : null}

        {sources.length > 0 ? (
          <InsightCard eyebrow="Sources" meta={<Count n={sourceCount} label={plural(sourceCount, "source")} />}>
            <ul className="m-0 list-none p-0">
              {sources.map((s) => (
                <li key={s.host} className="flex justify-between gap-3 border-b border-line py-1.5 text-[13.5px]">
                  <span className="min-w-0 truncate">{s.site}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{s.urls.length}</span>
                </li>
              ))}
            </ul>
            <details className="group text-[13px]">
              <summary className="cursor-pointer list-none rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show all {sourceCount} links</span>
                <span className="hidden group-open:inline">Hide links</span>
              </summary>
              <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
                {sources.flatMap((s) =>
                  s.urls.map((url) => (
                    <li key={url} className="min-w-0">
                      <a href={url} target="_blank" rel="noreferrer" className={cn(linkClass, "block truncate font-mono text-xs text-muted-foreground")}>
                        {url}
                      </a>
                    </li>
                  )),
                )}
              </ul>
            </details>
          </InsightCard>
        ) : null}
      </div>

      {hasAbout ? (
        <InsightCard eyebrow="About the role">
          {description ? (
            <p className="m-0 max-w-[760px] whitespace-pre-wrap text-sm leading-[1.6] text-muted-foreground">{description}</p>
          ) : null}
          {jd.techStack.length > 0 ? (
            <ul aria-label="Tech stack" className="m-0 flex list-none flex-wrap gap-[5px] p-0">
              {jd.techStack.map((t) => (
                <li key={t} className="rounded-full bg-panel px-2.5 py-[3px] text-[11.5px] text-muted-foreground">
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          {jd.sourceUrl && !jd.practiceTemplate ? (
            <a href={jd.sourceUrl} target="_blank" rel="noreferrer" className={cn(linkClass, "self-start text-[13px] underline")}>
              Original posting ↗
            </a>
          ) : null}
        </InsightCard>
      ) : null}
    </div>
  );
}
