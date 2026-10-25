import { cn } from "@/lib/utils/cn";
import { CURRENT_WEEK, TRACKS, WEEKS, type TrackTone } from "./content";
import { CONTAINER } from "./primitives";

const SEGMENTS = 4;
/** Horizontal position of the "today" line: centre of the current week column. */
const NOW_FRACTION = (CURRENT_WEEK + 0.5) / WEEKS.length;

const BAR: Record<TrackTone, string> = {
  ink: "bg-primary text-primary-foreground",
  soft: "bg-line-2 text-foreground",
  panel: "bg-surface-2 text-muted-foreground",
  custom: "bg-surface-2 text-faint",
};
const SEGMENT_DONE: Record<TrackTone, string> = {
  ink: "bg-brand",
  soft: "bg-foreground",
  panel: "bg-foreground",
  custom: "bg-line-2",
};
const SEGMENT_TODO: Record<TrackTone, string> = {
  ink: "bg-faint",
  soft: "bg-line-4",
  panel: "bg-line-2",
  custom: "bg-line-2",
};

/** "Track how ready you are" — an example readiness timeline across target roles. */
export function ReadinessTimeline() {
  return (
    <section id="readiness" className={cn(CONTAINER, "scroll-mt-16 pt-24 sm:pt-[120px]")}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h2 data-reveal className="iq-h2 max-w-[560px]">
          Track how ready you are, role by role
        </h2>
        <p className="m-0 max-w-[400px] text-[17px] leading-[1.5] text-muted-foreground">
          Clear each round of a company&apos;s process to go from Getting started to Interview-ready.
        </p>
      </div>

      {/* Phones: one card per role with a segmented progress bar; the chart below needs width. */}
      <ul data-reveal className="m-0 mt-10 flex list-none flex-col gap-3 p-0 sm:hidden">
        {TRACKS.map((track) => {
          const m = /^(\d+)\s*\/\s*(\d+)$/.exec(track.label);
          const cleared = m ? Number(m[1]) : 0;
          const total = m ? Number(m[2]) : SEGMENTS;
          return (
            <li key={track.role} className="iq-glass-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="m-0 text-[15px] font-semibold tracking-[-0.01em]">{track.role}</p>
                <p className="m-0 flex-none text-xs text-ink-3">{track.level}</p>
              </div>
              <div className="mt-3 flex items-center gap-1.5" aria-hidden>
                {Array.from({ length: total }, (_, i) => (
                  <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < cleared ? "bg-foreground" : "bg-line-2")} />
                ))}
              </div>
              <p className="m-0 mt-2.5 text-[13px] text-muted-foreground">
                {m ? `${cleared} of ${total} rounds cleared` : "Standalone practice, not counted toward readiness"}
              </p>
            </li>
          );
        })}
      </ul>

      <figure data-reveal className="iq-stage m-0 mt-10 hidden p-3 sm:block sm:px-9 sm:py-10">
        <figcaption className="sr-only">Example readiness timeline for four target roles</figcaption>
        <div
          tabIndex={0}
          role="region"
          aria-label="Readiness timeline (scrolls horizontally)"
          className="overflow-x-auto rounded-[22px] bg-card shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="min-w-[640px] [--role:150px] sm:min-w-[760px] sm:[--role:200px]">
            <div className="grid grid-cols-[var(--role)_repeat(8,minmax(0,1fr))] border-b border-line text-xs font-semibold tracking-[0.05em] text-faint">
              <div className="px-3.5 py-3.5 sm:px-[18px]">ROLE</div>
              {WEEKS.map((week, i) => (
                <div key={week} className={cn("py-3.5 text-center", i === CURRENT_WEEK && "text-foreground")}>
                  {week}
                </div>
              ))}
            </div>
            <div className="relative">
              <span
                aria-hidden
                className="absolute inset-y-0 w-px bg-foreground opacity-40"
                style={{ left: `calc(var(--role) + (100% - var(--role)) * ${NOW_FRACTION})` }}
              />
              {TRACKS.map((track) => (
                <div
                  key={track.role}
                  className="grid h-[66px] grid-cols-[var(--role)_minmax(0,1fr)] items-center border-b border-line last:border-b-0"
                >
                  <div className="px-3.5 sm:px-[18px]">
                    <div className="text-sm font-medium">{track.role}</div>
                    <div className="mt-0.5 text-xs text-faint">{track.level}</div>
                  </div>
                  <div className="relative h-full">
                    <div
                      className={cn(
                        "absolute top-5 flex h-[28px] items-center gap-[5px] overflow-hidden whitespace-nowrap rounded-full px-3 text-xs font-medium",
                        BAR[track.tone],
                      )}
                      style={{ left: track.left, width: track.width }}
                    >
                      {Array.from({ length: SEGMENTS }, (_, i) => (
                        <span
                          key={i}
                          aria-hidden
                          className={cn(
                            "h-1 flex-1 rounded-full",
                            i < track.done ? SEGMENT_DONE[track.tone] : SEGMENT_TODO[track.tone],
                          )}
                        />
                      ))}
                      <span className="ml-1 flex-none">{track.label}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </figure>
    </section>
  );
}
