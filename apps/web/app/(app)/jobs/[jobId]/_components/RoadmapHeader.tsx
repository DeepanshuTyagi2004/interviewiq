import Link from "next/link";
import { ROUTES } from "@/lib/constants/shared";
import { CompanyArt, SegmentBar } from "@/components/ds";
import type { JdDetail } from "@/features/jobs";
import { levelLabel, plural, specializationLabel } from "@/app/(app)/jobs/_components/library";
import { levelGapText, MatchPill, type MatchFit } from "@/app/(app)/jobs/_components/MatchPill";
import { confidenceWord } from "./insights";
import { RoleActions } from "./RoleActions";
import { isAdminVerifiedProcess } from "./rounds";

const READINESS_STEPS = 4;

/**
 * Readiness for this JD. Loop progress isn't tracked yet, so this is always the empty
 * "Not started" meter: never a made-up level.
 */
export function ReadinessMeter() {
  return (
    <div role="group" aria-label="Readiness" className="flex w-full flex-col gap-2 sm:w-[260px]">
      <p className="m-0 flex justify-between gap-3 text-[13px]">
        <span className="text-ink-3">Mock-interview readiness</span>
        <span>Not started</span>
      </p>
      <SegmentBar segments={READINESS_STEPS} filled={0} size="md" />
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
  /** The profile has nothing to match yet: invite the user to add some instead of showing 0%. */
  noFitEvidence?: boolean;
}

/**
 * The hero: company art, "Company · JD title", the meta line, the match chip, the readiness state and the
 * actions. The top bar already shows the breadcrumb.
 */
export function RoadmapHeader({ jd, headquarters, fit = null, noFitEvidence = false }: RoadmapHeaderProps) {
  const gap = fit ? levelGapText(fit.levelGap, jd.level) : null;
  const title = `${jd.companyName} · ${jd.title}`;
  const hasRounds = (jd.interviewProcess?.rounds ?? []).length > 0;
  return (
    <header>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <CompanyArt slug={jd.company} name={jd.companyName} className="h-[104px] w-full flex-none text-[22px] sm:w-[176px]" />
        <div className="min-w-0">
          <h1 title={title} className="m-0 line-clamp-3 break-words font-display text-[32px] font-light leading-[1.1] tracking-[-0.035em] sm:text-[40px]">
            {title}
          </h1>
          <p className="m-0 mt-2 text-[14px] leading-[1.5] text-ink-2">{roadmapMeta(jd, headquarters)}</p>
          {fit && fit.score !== null ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
              <MatchPill fit={fit} />
              {gap}
            </div>
          ) : noFitEvidence ? (
            <p className="m-0 mt-3 text-[12.5px] text-ink-3">
              <Link href={ROUTES.connections} className="underline underline-offset-4 hover:text-foreground">
                Add your resume or a coding profile
              </Link>{" "}
              to see how well you match this role.
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
        {jd.practiceTemplate ? <p className="m-0 text-[13px] text-ink-3">Practice only · not counted towards readiness</p> : <ReadinessMeter />}
        {hasRounds ? <RoleActions jd={jd} /> : null}
      </div>
      {hasRounds && !jd.practiceTemplate ? (
        <p className="m-0 mt-3 max-w-2xl text-[12.5px] leading-[1.5] text-ink-3">
          Only this suggested process counts towards your readiness. A customised copy is practice only.
        </p>
      ) : null}
    </header>
  );
}
