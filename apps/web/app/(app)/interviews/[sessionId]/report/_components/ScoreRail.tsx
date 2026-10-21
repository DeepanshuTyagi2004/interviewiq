"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Chip, Meter, Stat, type ChipTone } from "@/components/ds";
import { BarsMascot } from "@/components/mascot/BarsMascot";
import { cn } from "@/lib/utils/cn";
import { formatScore, outcomeMeta, verdictLabel, type OutcomeTone, type RoundReport } from "@/features/report";
import { FOCUS_RING } from "./styles";

export interface RailCta {
  /** Link target; null renders a disabled button. */
  href: string | null;
  label: string;
}

export interface RailNavItem {
  id: string;
  label: string;
  count?: number;
}

const CHIP_TONE: Record<OutcomeTone, { tone: ChipTone; dot?: "filled" | "hollow" }> = {
  brand: { tone: "ink", dot: "filled" },
  ink: { tone: "outline", dot: "hollow" },
  warn: { tone: "outline", dot: "hollow" },
  soft: { tone: "default" },
};

/** "25 Oct" */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The id of the last section whose top has scrolled past the sticky bar (first one before any has). */
function useActiveSection(ids: string[]): [string | null, (id: string) => void] {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = key
      .split("|")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // The first section (in page order) that is on screen wins.
        const first = els.find((el) => visible.has(el.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-80px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key]);
  return [active, setActive];
}

interface Props {
  report: RoundReport;
  cta: RailCta | null;
  nav: RailNavItem[];
}

/** Sticky left rail: score, pass-mark meter, outcome, verdict, CTA, section nav. */
export function ScoreRail({ report, cta, nav }: Props) {
  const score = report.score ?? null;
  const pass = report.passMark ?? null;
  const outcome = outcomeMeta(report.outcome ?? "unscorable");
  const chip = CHIP_TONE[outcome.tone];
  const [active, setActive] = useActiveSection(nav.map((n) => n.id));
  const passed = report.outcome === "passed";
  return (
    <aside
      // The aside scrolls on tall rails, which also clips horizontally: the side padding keeps the card's ring and float
      // intact, and the top padding is headroom for the mascot's jump.
      className={cn("lg:sticky lg:top-[60px] lg:-mx-2 lg:max-h-[calc(100vh-60px)] lg:self-start lg:overflow-y-auto lg:px-2 lg:pb-6", passed ? "pt-6" : "lg:pt-4")}
      aria-label="Score summary"
    >
      {passed ? (
        <div className="flex justify-center pb-3">
          <BarsMascot mood="laughing" once size={96} />
        </div>
      ) : null}
      <Card flush as="div">
        <div className="flex flex-col gap-5 p-6">
          <Stat label="Round score" value={score === null ? "—" : formatScore(score)} unit={score === null ? undefined : "/ 10"} />
          {score !== null ? (
            <div className="flex flex-col gap-2.5" data-testid="score-bar">
              <Meter value={score / 10} mark={pass !== null ? pass / 10 : undefined} label={`Score ${formatScore(score)} out of 10`} />
              {pass !== null ? <p className="m-0 font-mono text-[12px] text-ink-3">Pass mark {formatScore(pass)}</p> : null}
            </div>
          ) : pass !== null ? (
            <p className="m-0 font-mono text-[12px] text-ink-3">Pass mark {formatScore(pass)}</p>
          ) : null}
          <div>
            <Chip tone={chip.tone} dot={chip.dot}>
              {outcome.label}
            </Chip>
          </div>
          {report.verdict ? (
            <p className="m-0 text-[13.5px] leading-[1.5] text-ink-3">
              Mock interviewer&apos;s recommendation: <span className="text-ink">{verdictLabel(report.verdict)}</span>
            </p>
          ) : null}
          {cta ? (
            cta.href ? (
              <Button asChild className="w-full">
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
            ) : (
              <Button disabled className="w-full">
                {cta.label}
              </Button>
            )
          ) : null}
        </div>
        <nav aria-label="Report sections" className="border-t border-line px-3 py-3">
          <ul className="m-0 flex list-none flex-wrap gap-1 p-0 lg:grid lg:gap-0.5">
            {nav.map((item) => {
              const on = active === item.id;
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={() => setActive(item.id)}
                    aria-current={on ? "location" : undefined}
                    className={cn(
                      "relative flex items-center justify-between gap-3 rounded-full px-4 py-1.5 text-[13.5px] transition-colors duration-150 ease-iq",
                      on ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink",
                      FOCUS_RING,
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-ink transition-opacity duration-150",
                        on ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {item.label}
                    {item.count !== undefined ? <span className="font-mono text-[11px] text-ink-3">{item.count}</span> : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </Card>
    </aside>
  );
}
