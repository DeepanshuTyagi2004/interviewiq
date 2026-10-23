import { Card } from "@/components/ds";

const PER_ROUND = [
  ["Format", "DSA, system design, low-level design or behavioural"],
  ["Content", "The topics covered and the problems you were asked"],
  ["Difficulty", "How hard it felt, and whether hints were given"],
  ["Outcome", "Whether you moved on, if you know"],
] as const;

/** Side panel: what makes a write-up useful, and what to leave out. */
export function ExperienceGuide() {
  return (
    <Card tone="surface" title="What helps most" className="lg:sticky lg:top-[60px]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[14px] font-medium">For each round, tell us</p>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {PER_ROUND.map(([title, body], i) => (
              <li key={title} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
                <span className="font-mono text-xs leading-5 text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 text-[13px] leading-5">
                  <span className="text-foreground">{title}</span>
                  <span className="block text-ink-2">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-1 border-t border-line pt-5">
          <p className="m-0 text-[14px] font-medium">Keep it descriptive</p>
          <p className="m-0 text-[13px] leading-[1.55] text-ink-2">
            Leave out interviewers’ names and anything confidential. Describe what happened, not who.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[14px] font-medium">Where it goes</p>
          <p className="m-0 text-[13px] leading-[1.55] text-ink-2">
            Your write-up is processed into that company’s interview research, the same research that builds its
            round-by-round process.
          </p>
        </div>
      </div>
    </Card>
  );
}
