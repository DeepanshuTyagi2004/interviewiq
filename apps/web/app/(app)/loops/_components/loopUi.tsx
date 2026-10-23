import Link from "next/link";
import { Chip } from "@/components/ds";
import { CompanyTile } from "@/app/(app)/jobs/_components/CompanyTile";
import { levelLabel, specializationLabel } from "@/app/(app)/jobs/_components/library";
import type { JdBrief, Loop } from "@/features/loops";
import { ROUTES } from "@/lib/constants/shared";

const LINK = "rounded-sm outline-none hover:underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** "Software Engineer (Fresher)" with "Company · Fresher · Backend" underneath. */
export function JdTitle({ jd, href, live = true, name, level }: { jd: JdBrief | null; href?: string; live?: boolean; name?: string; level?: string | null }) {
  if (!jd) {
    const title = name || "Custom practice";
    const sub = [level ? levelLabel(level) : "Choose a level", "Standalone practice"].join(" · ");
    const body = <><span className="block truncate text-[15px] font-medium" title={title}>{title}</span><span className="block truncate text-[12.5px] text-ink-3" title={sub}>{sub}</span></>;
    return href ? <Link href={href} className={`block min-w-0 ${LINK}`}>{body}</Link> : <div className="min-w-0">{body}</div>;
  }
  const title = name || jd.title;
  const sub = [jd.companyName, levelLabel(level ?? jd.level), jd.practiceTemplate ? "Practice template" : null, jd.specialization ? specializationLabel(jd.specialization) : null].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className="block truncate text-[15px] font-medium" title={title}>{title}</span>
      <span className="block truncate text-[12.5px] text-ink-3" title={sub}>{sub}</span>
    </>
  );
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <CompanyTile name={jd.companyName} live={live} size="sm" />
      <div className="min-w-0">
        {href ? <Link href={href} className={`block min-w-0 ${LINK}`}>{body}</Link> : body}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<Loop["status"], string> = { active: "Active", paused: "Paused", abandoned: "Abandoned", completed: "Completed" };

export function LoopStatusPill({ status }: { status: Loop["status"] }) {
  if (status === "active") return <Chip dot="filled">{STATUS_LABEL[status]}</Chip>;
  if (status === "completed") return <Chip tone="ink" dot="filled">{STATUS_LABEL[status]}</Chip>;
  if (status === "paused") return <Chip tone="outline" dot="hollow">{STATUS_LABEL[status]}</Chip>;
  return <Chip tone="outline" className="text-ink-3">{STATUS_LABEL[status]}</Chip>;
}

/** Official tracks count towards readiness; edited ones are standalone practice. Never a badge. */
export function KindPill({ loop }: { loop: Pick<Loop, "kind" | "countsTowardReadiness"> }) {
  return loop.countsTowardReadiness ? (
    <span title="Unedited suggested process: counts towards readiness for this role"><Chip>Suggested process</Chip></span>
  ) : (
    <span title="Edited process: fully analysed, but not counted towards readiness"><Chip tone="outline">Standalone · not counted</Chip></span>
  );
}

export const loopHref = (id: string) => `${ROUTES.loops}/${id}`;
export const processHref = (id: string) => `${ROUTES.processes}/${id}`;
