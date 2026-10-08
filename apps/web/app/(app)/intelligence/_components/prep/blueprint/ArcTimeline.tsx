import { HudCard } from "@/components/hud";
import { LookPill } from "@/components/observability/ConsoleCard";
import { GHOST_PILL } from "@/components/observability/status";
import type { Blueprint } from "@/features/blueprints";
import { cn } from "@/lib/utils/cn";

const PHASE_LABEL: Record<string, string> = {
  greeting: "Greeting",
  small_talk: "Small talk",
  framing: "Framing",
  candidate_intro: "Candidate intro",
  core: "Core",
  candidate_questions: "Candidate questions",
  wrap_up: "Wrap-up",
};

/**
 * The interview's arc (stage 4): a proportional bar of the phases' timeboxes (scored phases solid),
 * then each phase with its minutes and guidance. The timeboxes should sum to the round's duration.
 */
export function ArcTimeline({ arc, durationMins }: { arc: Blueprint["arc"]; durationMins: number | null }) {
  const total = arc.reduce((sum, a) => sum + (a.timebox_mins ?? 0), 0);
  const off = durationMins != null && Math.abs(total - durationMins) > 1;
  return (
    <HudCard
      title="Arc"
      spotlight={false}
      meta={
        <span className={cn(off && "text-destructive")}>
          {total} min{durationMins != null ? ` of ${durationMins}` : ""}
        </span>
      }
      bodyClassName="space-y-4 px-4 py-4 sm:px-5"
    >
      {arc.length ? (
        <div aria-hidden className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
          {arc.map((a, i) => (
            <span
              key={i}
              title={`${a.phase ?? "phase"} · ${a.timebox_mins ?? 0} min`}
              className={cn("h-full min-w-[6px]", a.scored ? "bg-foreground/80" : "bg-line-3")}
              style={{ flexGrow: Math.max(1, a.timebox_mins ?? 0), flexBasis: 0 }}
            />
          ))}
        </div>
      ) : null}
      <ol className="m-0 list-none space-y-2.5 p-0">
        {arc.map((a, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 sm:grid-cols-[160px_56px_80px_minmax(0,1fr)]">
            <span className="text-[13px]">{PHASE_LABEL[a.phase ?? ""] ?? a.phase ?? "—"}</span>
            <span className="text-right font-mono text-[12px] tabular-nums text-muted-foreground sm:text-left">{a.timebox_mins ?? "—"} min</span>
            <span className="col-span-2 sm:col-span-1">
              <LookPill look={a.scored ? { tone: "soft" } : GHOST_PILL}>{a.scored ? "scored" : "unscored"}</LookPill>
            </span>
            <span className="col-span-2 text-[12.5px] leading-[1.5] text-muted-foreground sm:col-span-1">{a.guidance || "—"}</span>
          </li>
        ))}
      </ol>
      {arc.length === 0 ? <p className="m-0 text-xs text-faint">No arc recorded.</p> : null}
    </HudCard>
  );
}
