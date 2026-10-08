"use client";

import { HudCard } from "@/components/hud";
import { formatRelativeTime } from "@/lib/utils/format";
import type { InterviewSession } from "@/features/interview";

/**
 * The candidate's briefing once the blueprint is ready: who interviews them, the format and the
 * length. Deliberately nothing about topics, problems or difficulty (spec §9.2).
 */
export function BriefingCard({ session }: { session: InterviewSession }) {
  const b = session.briefing;
  if (!b) return null;
  const rows: [string, string][] = [
    ["Interviewer", b.interviewerName],
    ["Style", b.interviewerStyle],
    ["Format", b.format],
    ["Duration", `${b.durationMins} minutes`],
  ];
  return (
    <HudCard title="Your briefing">
      <dl className="m-0">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-line px-4 py-3 text-[13.5px] last:border-b-0 sm:px-5">
            <dt className="text-faint">{label}</dt>
            <dd className="m-0 min-w-0 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 px-4 pb-4 pt-3 text-[12.5px] leading-[1.5] text-muted-foreground sm:px-5">
        {session.prep.refreshing
          ? "Updating for your latest profile…"
          : `Prepared ${session.prep.preparedAt ? formatRelativeTime(session.prep.preparedAt) : "recently"}. If your profile or the job changes before your slot, we'll refresh it automatically.`}
      </p>
    </HudCard>
  );
}
