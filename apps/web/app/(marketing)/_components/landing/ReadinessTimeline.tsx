import { cn } from "@/lib/utils/cn";
import { CURRENT_WEEK, TRACKS, WEEKS, type TrackTone } from "./content";
import { CONTAINER, Eyebrow } from "./primitives";

const SEGMENTS = 4;
/** Horizontal position of the "today" line: centre of the current week column. */
const NOW_FRACTION = (CURRENT_WEEK + 0.5) / WEEKS.length;

const BAR: Record<TrackTone, string> = {
  ink: "bg-primary text-primary-foreground",
  soft: "bg-line-2 text-foreground",
  panel: "bg-panel text-muted-foreground",
  custom: "bg-panel text-faint",
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
        <div className="flex flex-col gap-4">
          <Eyebrow>READINESS</Eyebrow>
          <h2 data-reveal className="iq-h2 max-w-[560px]">
            Track how ready you are, role by role
          </h2>
        </div>
        <p className="m-0 max-w-[400px] text-[15px] leading-[1.55] text-muted-foreground">
          Readiness rises as you clear rounds of the official process — from getting started to interview-ready.
        </p>
      </div>

      <figure data-reveal className="m-0 mt-10 bg-panel p-3 sm:px-9 sm:py-10">
        <figcaption className="sr-only">Example readiness timeline for four target roles</figcaption>
        <div
          tabIndex={0}
          role="region"
          aria-label="Readiness timeline (scrolls horizontally)"
          className="overflow-x-auto rounded-[10px] bg-card shadow-[0_20px_50px_-24px_rgba(0,0,0,.18)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <div className="min-w-[640px] [--role:150px] sm:min-w-[760px] sm:[--role:200px]">
            <div className="grid grid-cols-[var(--role)_repeat(8,minmax(0,1fr))] border-b border-line font-mono text-[10px] tracking-[0.06em] text-faint">
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
                    <div className="text-[13.5px]">{track.role}</div>
                    <div className="mt-0.5 text-[11.5px] text-faint">{track.level}</div>
                  </div>
                  <div className="relative h-full">
                    <div
                      className={cn(
                        "absolute top-5 flex h-[26px] items-center gap-[5px] overflow-hidden whitespace-nowrap rounded-[5px] px-2.5 text-[11.5px]",
                        BAR[track.tone],
                      )}
                      style={{ left: track.left, width: track.width }}
                    >
                      {Array.from({ length: SEGMENTS }, (_, i) => (
                        <span
                          key={i}
                          aria-hidden
                          className={cn(
                            "h-1 flex-1 rounded-sm",
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
