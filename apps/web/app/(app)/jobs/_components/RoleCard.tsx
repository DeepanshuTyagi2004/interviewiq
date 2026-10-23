import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { JdSummary } from "@/features/jobs";
import { CompanyMark } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/lib/constants/shared";
import { DepthMeter } from "./DepthMeter";
import { depthOf, specializationLabel } from "./library";
import { levelGapText, MatchPill, type MatchFit } from "./MatchPill";
import { payText, yoeText } from "./roleFilters";

const MAX_STACK = 5;

/**
 * One role: full title, company · specialization, pay and experience, tech stack, data depth and the
 * user's match. The card never waits on the match: without it (loading, failed) it renders as before.
 */
export function RoleCard({ jd, fit = null, fitLoading = false }: { jd: JdSummary; fit?: MatchFit | null; fitLoading?: boolean }) {
  const stack = jd.techStack ?? [];
  const sub = [jd.companyName, jd.specialization ? specializationLabel(jd.specialization) : null].filter(Boolean).join(" · ");
  const facts = [payText(jd), yoeText(jd)].filter(Boolean).join(" · ");
  const gap = fit ? levelGapText(fit.levelGap, jd.level) : null;
  return (
    <li className="flex min-w-0 flex-col">
      <Link
        href={`${ROUTES.jobs}/${jd.id}`}
        className="group/role relative flex flex-1 items-start gap-4 rounded-card bg-surface p-5 shadow-ring outline-none transition-transform duration-200 ease-iq hover:-translate-y-[3px] focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <CompanyMark seed={jd.company} name={jd.companyName ?? jd.company} size={42} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span title={jd.title} className="line-clamp-2 break-words font-display text-[17px] font-normal leading-snug tracking-[-0.02em]">{jd.title}</span>
          <span className="mt-1 block truncate text-[13px] text-ink-3">{sub}</span>
          {facts ? <span className="mt-1 block text-[13px] text-ink-2">{facts}</span> : null}
          {gap ? <span className="mt-1 block text-[13px] text-ink-3">{gap}</span> : null}
          {stack.length > 0 ? (
            <span className="mt-3 block leading-none" aria-label="Tech stack">
              {stack.slice(0, MAX_STACK).map((t) => (
                <span key={t} className="mb-1.5 mr-1.5 inline-block max-w-full truncate rounded-full bg-background px-2.5 py-1 align-top text-[12px] leading-none text-ink-2 shadow-ring">
                  {t}
                </span>
              ))}
              {stack.length > MAX_STACK ? <span className="mb-1.5 inline-block px-1 py-1 text-[12px] leading-none text-ink-3">+{stack.length - MAX_STACK}</span> : null}
            </span>
          ) : null}
          {/* Phones: depth as its own line so the title keeps the width. */}
          <span className={jd.practiceTemplate ? "mt-2 block text-[13px] text-ink-2" : "mt-2 block text-[13px] text-ink-2 min-[420px]:hidden"}>{jd.practiceTemplate ? "Practice template" : `Data depth · ${depthOf(jd.dataAvailability).label}`}</span>
        </span>
        <span className="flex flex-none flex-col items-end gap-2">
          {fit ? <MatchPill fit={fit} /> : fitLoading ? <Skeleton aria-hidden className="h-[26px] w-[84px] rounded-full" /> : null}
          {jd.practiceTemplate ? null : <DepthMeter availability={jd.dataAvailability} compact className="mt-1 hidden min-[420px]:flex" />}
        </span>
        <ArrowRight
          aria-hidden
          className="mt-1 h-4 w-4 flex-none text-ink-3 group-hover/role:translate-x-0.5 group-focus-visible/role:translate-x-0.5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-iq"
        />
      </Link>
    </li>
  );
}
