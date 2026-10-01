import { cn } from "@/lib/utils/cn";
import { MonoPill, type MonoPillTone } from "@/components/patterns";
import { RESEARCH_ROUNDS, RESEARCH_SOURCES, type RoundState } from "./content";

const PILL: Record<RoundState, MonoPillTone> = { passed: "soft", next: "brand", locked: "ghost" };

/** "Company research" illustration: shared sources feeding one company's round-by-round process. */
export function ResearchPanel() {
  return (
    <div className="flex w-full flex-col items-center">
      <div className="flex items-center gap-1 rounded-lg bg-card px-2 py-1.5 shadow-hairline">
        <span className="px-2 font-mono text-[9.5px] leading-[1.2] tracking-[0.06em] text-faint">
          SHARED
          <br />
          SOURCES
        </span>
        {RESEARCH_SOURCES.map((s) => (
          <span
            key={s}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-line font-mono text-[10.5px]"
          >
            {s}
          </span>
        ))}
      </div>
      <span aria-hidden className="h-8 w-px bg-line-4" />
      <div className="iq-float flex w-full max-w-[380px] flex-col gap-1.5 p-4 sm:p-[18px]">
        <p className="m-0 px-1 pb-1.5 font-mono text-[9.5px] tracking-[0.08em] text-faint">MEESHO · SDE I BACKEND</p>
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {RESEARCH_ROUNDS.map((r) => (
            <li
              key={r.n}
              className={cn(
                "grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-1.5 py-[9px]",
                r.state === "next" && "bg-panel",
              )}
            >
              <span className="font-mono text-[10.5px] text-faint">{r.n}</span>
              <span className={cn("truncate text-[13.5px]", r.state === "locked" ? "text-faint" : "text-foreground")}>
                {r.title}
              </span>
              <MonoPill tone={PILL[r.state]}>{r.status}</MonoPill>
            </li>
          ))}
        </ol>
        <dl className="m-0 mt-2 flex flex-col gap-[7px] border-t border-line pt-3 text-[12.5px]">
          <Stat label="Experiences">
            <span data-count="142">142</span>
          </Stat>
          <Stat label="Difficulty">Medium–hard</Stat>
          <Stat label="Data depth">High</Stat>
        </dl>
        <span aria-hidden className="mt-2.5 h-[3px] rounded-sm bg-gradient-to-r from-foreground via-faint to-line-2" />
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
