import Link from "next/link";
import { SegmentMeter } from "@/components/hud";
import type { JdDetail } from "@/features/jobs";
import { ROUTES } from "@/lib/constants/shared";
import { CompanyTile } from "@/app/(app)/jobs/_components/CompanyTile";
import { isLiveJd, levelLabel, plural, specializationLabel } from "@/app/(app)/jobs/_components/library";
import { levelGapText, MatchPill, type MatchFit } from "@/app/(app)/jobs/_components/MatchPill";
import { confidenceWord } from "./insights";
import { isAdminVerifiedProcess } from "./rounds";

const READINESS_STEPS = 4;

/**
 * Readiness for this JD. Loop progress isn't tracked yet, so this is always the empty
 * "Not started" meter: never a made-up level.
 */
export function ReadinessMeter() {
  return (
    <div role="group" aria-label="Readiness" className="flex w-full flex-col gap-2 sm:w-[240px]">
      <p className="m-0 flex justify-between gap-3 text-[13px]">
        <span className="text-faint">Readiness</span>
        <span>Not started</span>
      </p>
      <SegmentMeter segments={READINESS_STEPS} filled={0} size="md" />
    </div>
  );
}

/** "Bengaluru, India · Fresher · Backend · Data depth high · 12 sources": real fields only. */
export function roadmapMeta(jd: JdDetail, headquarters: string | null | undefined): string {
  const confidence = confidenceWord(jd.dataConfidence ?? jd.interviewProcess?.data_confidence);
  const sourceCount = new Set(jd.sources.map((source) => source.trim()).filter(Boolean)).size;
  return [
    headquarters?.trim() || null,
    levelLabel(jd.level),
    jd.specialization ? specializationLabel(jd.specialization) : null,
    jd.practiceTemplate ? "Practice template" : isAdminVerifiedProcess(jd.interviewProcess) ? "Admin-verified process" : confidence ? `Data depth ${confidence}` : "No interview data yet",
    !jd.practiceTemplate && sourceCount > 0 ? plural(sourceCount, "source") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface RoadmapHeaderProps {
  jd: JdDetail;
  headquarters?: string | null;
  /** The user's match for this JD; omitted while loading or when it failed. */
  fit?: MatchFit | null;
}

/** Breadcrumb, company tile, "Company · JD title", the meta line and the readiness meter. */
export function RoadmapHeader({ jd, headquarters, fit = null }: RoadmapHeaderProps) {
  const gap = fit ? levelGapText(fit.levelGap, jd.level) : null;
  const crumb = "rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  return (
    <>
      <nav aria-label="Breadcrumb">
        <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-[13px] text-faint">
          <li className="flex items-center gap-2">
            <Link href={ROUTES.jobs} className={crumb}>
              Companies
            </Link>
            <span aria-hidden>›</span>
          </li>
          <li className="flex items-center gap-2">
            <Link href={`${ROUTES.jobs}/c/${encodeURIComponent(jd.company)}`} className={crumb}>
              {jd.companyName}
            </Link>
            <span aria-hidden>›</span>
          </li>
          <li aria-current="page" className="min-w-0 text-foreground">
            {jd.title}
          </li>
        </ol>
      </nav>

      <div className="mt-[18px] flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
          <CompanyTile name={jd.companyName} live={isLiveJd(jd)} size="lg" />
          <div className="min-w-0">
            <h1 className="m-0 text-balance text-[28px] font-normal leading-[1.1] tracking-[-0.045em] sm:text-[34px]">
              {jd.companyName} · {jd.title}
            </h1>
            <p className="m-0 mt-1 text-[13.5px] leading-[1.5] text-muted-foreground">{roadmapMeta(jd, headquarters)}</p>
            {fit && fit.score !== null ? (
              <p className="m-0 mt-2 flex flex-wrap items-center gap-2 text-xs text-faint">
                <MatchPill fit={fit} />
                {gap}
              </p>
            ) : null}
          </div>
        </div>
        {jd.practiceTemplate ? <p className="m-0 text-xs text-faint">Practice only · not counted towards readiness</p> : <ReadinessMeter />}
      </div>
    </>
  );
}
