import { Panel } from "@/components/patterns";

const PER_ROUND = [
  ["Format", "DSA, system design, low-level design or behavioural"],
  ["Content", "The topics covered and the problems you were asked"],
  ["Difficulty", "How hard it felt, and whether hints were given"],
  ["Outcome", "Whether you moved on, if you know"],
] as const;

/** Side panel: what makes a write-up useful, and what to leave out. */
export function ExperienceGuide() {
  return (
    <Panel eyebrow="What helps most" className="lg:sticky lg:top-6">
      <div className="iq-float flex flex-col gap-3 p-5">
        <p className="m-0 text-sm">For each round, tell us</p>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {PER_ROUND.map(([title, body], i) => (
            <li key={title} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2.5">
              <span className="font-mono text-[11px] leading-5 text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0 text-[13px] leading-5">
                <span className="text-foreground">{title}</span>
                <span className="block text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-4 px-1">
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm">Keep it descriptive</p>
          <p className="m-0 text-[13px] leading-[1.55] text-muted-foreground">
            Leave out interviewers’ names and anything confidential. Describe what happened, not who.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm">Where it goes</p>
          <p className="m-0 text-[13px] leading-[1.55] text-muted-foreground">
            Your write-up is processed into that company’s interview research, the same research that builds its
            round-by-round process.
          </p>
        </div>
      </div>
    </Panel>
  );
}
