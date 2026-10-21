"use client";

import { Card, Orb } from "@/components/ds";
import { formatRelativeTime } from "@/lib/utils/format";
import type { InterviewSession } from "@/features/interview";
import { formatScore } from "@/features/report/presentation";

/**
 * The candidate's briefing once the blueprint is ready, as the interviewer's profile: who interviews
 * them, the format, the length and the pass mark. Deliberately nothing about topics, problems or
 * difficulty (spec §9.2).
 */
export function BriefingCard({ session }: { session: InterviewSession }) {
  const b = session.briefing;
  if (!b) return null;
  const rows: [string, string][] = [
    ["Format", b.format],
    ["Duration", `${b.durationMins} minutes`],
  ];
  return (
    <Card tone="stone" title="Your briefing">
      <div className="flex items-center gap-5">
        <Orb seed={b.interviewerName} size={88} />
        <div className="min-w-0">
          <p className="m-0 break-words font-display text-[28px] font-normal leading-[1.1] tracking-[-0.03em]">{b.interviewerName}</p>
          <p className="m-0 mt-1.5 break-words text-[14px] leading-[1.5] text-ink-2">{b.interviewerStyle}</p>
        </div>
      </div>
      <dl className="m-0 mt-5">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-t border-line py-3 text-[14px]">
            <dt className="text-ink-3">{label}</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {session.passMark != null ? (
        <p className="m-0 border-t border-line py-3 text-[14px] tabular-nums text-ink">
          Pass mark {formatScore(session.passMark)} / 10
        </p>
      ) : null}
      <p className="m-0 border-t border-line pt-3 text-[13px] leading-[1.5] text-ink-3">
        {session.prep.refreshing
          ? "Updating for your latest profile…"
          : `Prepared ${session.prep.preparedAt ? formatRelativeTime(session.prep.preparedAt) : "recently"}. If your profile or the job changes before your slot, we'll refresh it automatically.`}
      </p>
    </Card>
  );
}
