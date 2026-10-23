import { cn } from "@/lib/utils/cn";
import { SmokedIcon, type SmokedIconName } from "@/components/ds";
import { MonoPill, type MonoPillTone } from "@/components/patterns";
import { RESEARCH_ROUNDS, RESEARCH_SOURCES, type RoundState } from "./content";

/** A custom icon per shared source (forum, coding site, company reviews, video). */
const SOURCE_ICON: Record<string, SmokedIconName> = { "r/": "share", LC: "practice", GD: "reviews", YT: "video" };

const PILL: Record<RoundState, MonoPillTone> = { passed: "soft", next: "brand", locked: "ghost" };

/** "Company research" illustration: shared sources feeding one company's round-by-round process. */
export function ResearchPanel() {
  return (
    <div className="flex w-full flex-col items-center">
      <div className="flex items-center gap-1 rounded-2xl bg-card px-2.5 py-2 shadow-ring">
        <span className="px-2 text-xs font-semibold leading-[1.2] tracking-[0.04em] text-faint">
          SHARED
          <br />
          SOURCES
        </span>
        {RESEARCH_SOURCES.map((s) => (
          <SmokedIcon key={s} name={SOURCE_ICON[s] ?? "practice"} size={36} />
        ))}
      </div>
      <span aria-hidden className="h-8 w-px bg-line-4" />
      <div className="iq-float flex w-full max-w-[380px] flex-col gap-1.5 p-4 sm:p-[18px]">
        <p className="m-0 px-1 pb-1.5 text-xs font-semibold tracking-[0.06em] text-faint">MEESHO · SDE I BACKEND</p>
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {RESEARCH_ROUNDS.map((r) => (
            <li
              key={r.n}
              className={cn(
                "grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl px-2 py-[10px]",
                r.state === "next" && "bg-surface",
              )}
            >
              <span className="text-xs font-medium tabular-nums text-faint">{r.n}</span>
              <span className={cn("truncate text-sm", r.state === "locked" ? "text-faint" : "text-foreground")}>
                {r.title}
              </span>
              <MonoPill tone={PILL[r.state]}>{r.status}</MonoPill>
            </li>
          ))}
        </ol>
        <dl className="m-0 mt-2 flex flex-col gap-[7px] border-t border-line pt-3 text-[13px]">
          <Stat label="Experiences">
            <span data-count="142">142</span>
          </Stat>
          <Stat label="Difficulty">Medium–hard</Stat>
          <Stat label="Data depth">High</Stat>
        </dl>
        <span aria-hidden className="mt-2.5 h-[3px] rounded-full bg-gradient-to-r from-foreground via-faint to-line-2" />
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <dt className="text-faint">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}
