import { HudCard } from "@/components/hud";
import type { Blueprint } from "@/features/blueprints";

/** The factors to collect across the whole interview. No scoring formula lives in the blueprint. */
export function EvaluationCard({ evaluation }: { evaluation: Blueprint["evaluation"] }) {
  const signals = evaluation.global_signals ?? [];
  return (
    <HudCard title="Global evaluation signals" spotlight={false} meta={<span>{signals.length}</span>} bodyClassName="space-y-3 px-4 py-4 sm:px-5">
      {signals.length ? (
        <ul className="m-0 space-y-1.5 pl-5 text-[13px] leading-[1.5]">
          {signals.map((g, i) => (
            <li key={i}>
              {g.signal ?? "—"}
              {g.observe ? <span className="text-muted-foreground"> · observe: {g.observe}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-xs text-faint">—</p>
      )}
      {evaluation.note ? <p className="m-0 text-xs text-muted-foreground">{evaluation.note}</p> : null}
    </HudCard>
  );
}
