import { HudCard } from "@/components/hud";
import type { Blueprint } from "@/features/blueprints";
import { Section } from "../ui";

/** Stage 5: rapport hooks and resume probes, each naming its source item, the round's own questions (hiring
 *  manager rounds) and the level's expectations. */
export function PersonalizationCard({ personalization }: { personalization: Blueprint["personalization"] }) {
  const hooks = personalization.rapport_hooks ?? [];
  const probes = personalization.resume_probes ?? [];
  const roundQuestions = personalization.round_questions ?? [];
  return (
    <HudCard title="Personalization" spotlight={false} bodyClassName="space-y-5 px-4 py-4 sm:px-5">
      <Section title={`Rapport hooks · ${hooks.length}`}>
        {hooks.length ? (
          <ul className="m-0 space-y-1.5 pl-5 text-[13px] leading-[1.5]">
            {hooks.map((h, i) => (
              <li key={i}>
                {h.line ?? "—"}
                <span className="block font-mono text-[11.5px] text-faint">source: {h.source || "—"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-xs text-faint">—</p>
        )}
      </Section>
      <Section title={`Resume probes · ${probes.length}`}>
        {probes.length ? (
          <ul className="m-0 space-y-2 pl-5 text-[13px] leading-[1.5]">
            {probes.map((p, i) => (
              <li key={i}>
                {p.prompt ?? "—"}
                <span className="block text-[12px] text-muted-foreground">Tests: {p.what_it_tests || "—"}</span>
                <span className="block font-mono text-[11.5px] text-faint">grounded in: {p.grounded_in || "—"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-xs text-faint">—</p>
        )}
      </Section>
      {roundQuestions.length > 0 && (
        <Section title={`Round questions · ${roundQuestions.length}`}>
          <ul className="m-0 space-y-2 pl-5 text-[13px] leading-[1.5]">
            {roundQuestions.map((q, i) => (
              <li key={i}>
                {q.prompt ?? "—"}
                <span className="block text-[12px] text-muted-foreground">Tests: {q.what_it_tests || "—"}</span>
                {q.expected ? <span className="block text-[12px] text-muted-foreground">Expected: {q.expected}</span> : null}
                <span className="block font-mono text-[11.5px] text-faint">covers: {q.covers || "—"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Level expectations">
        <p className="m-0 text-[13px] leading-[1.5]">{personalization.level_expectations || "—"}</p>
      </Section>
    </HudCard>
  );
}
