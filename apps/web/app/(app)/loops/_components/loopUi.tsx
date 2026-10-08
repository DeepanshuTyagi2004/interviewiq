import Link from "next/link";
import { MonoPill } from "@/components/patterns";
import { CompanyTile } from "@/app/(app)/jobs/_components/CompanyTile";
import { levelLabel, specializationLabel } from "@/app/(app)/jobs/_components/library";
import type { JdBrief, Loop } from "@/features/loops";
import { ROUTES } from "@/lib/constants/shared";

/** "Software Engineer (Fresher)" with "Company · Fresher · Backend" underneath. */
export function JdTitle({ jd, href, live = true, name, level }: { jd: JdBrief | null; href?: string; live?: boolean; name?: string; level?: string | null }) {
  if (!jd) {
    const body = <><span className="block text-[15px]">{name || "Custom practice"}</span><span className="block text-xs text-faint">{[level ? levelLabel(level) : "Choose a level", "Standalone practice"].join(" · ")}</span></>;
    return href ? <Link href={href} className="hover:underline underline-offset-4">{body}</Link> : <div>{body}</div>;
  }
  const sub = [jd.companyName, levelLabel(level ?? jd.level), jd.practiceTemplate ? "Practice template" : null, jd.specialization ? specializationLabel(jd.specialization) : null].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className="block truncate text-[15px]">{name || jd.title}</span>
      <span className="block truncate text-xs text-faint">{sub}</span>
    </>
  );
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <CompanyTile name={jd.companyName} live={live} size="sm" />
      <div className="min-w-0">
        {href ? <Link href={href} className="block min-w-0 hover:underline underline-offset-4">{body}</Link> : body}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<Loop["status"], string> = { active: "Active", paused: "Paused", abandoned: "Abandoned", completed: "Completed" };

export function LoopStatusPill({ status }: { status: Loop["status"] }) {
  return <MonoPill tone={status === "active" ? "brand" : status === "completed" ? "ink" : "ghost"}>{STATUS_LABEL[status]}</MonoPill>;
}

/** Official tracks count towards readiness; edited ones are standalone practice. Never a badge. */
export function KindPill({ loop }: { loop: Pick<Loop, "kind" | "countsTowardReadiness"> }) {
  return loop.countsTowardReadiness ? (
    <MonoPill tone="soft" title="Unedited suggested process: counts towards readiness for this role">Suggested process</MonoPill>
  ) : (
    <MonoPill tone="ghost" title="Edited process: fully analysed, but not counted towards readiness">Standalone · not counted</MonoPill>
  );
}

export const loopHref = (id: string) => `${ROUTES.loops}/${id}`;
export const processHref = (id: string) => `${ROUTES.processes}/${id}`;
