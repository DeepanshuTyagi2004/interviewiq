import { HudCard } from "@/components/hud";
import type { Blueprint } from "@/features/blueprints";
import { Facts, Lines, Section } from "../ui";

/** Who the interviewer is (stage 4), and what that persona is grounded in. */
export function PersonaCard({ persona }: { persona: Blueprint["persona"] }) {
  return (
    <HudCard title="Persona" spotlight={false} bodyClassName="space-y-4 px-4 py-4 sm:px-5">
      <div>
        <p className="m-0 text-[17px] tracking-[-0.01em]">{persona.name || "Unnamed interviewer"}</p>
        {persona.seniority ? <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{persona.seniority}</p> : null}
      </div>
      <Facts
        items={[
          ["Style", persona.style || "—"],
          ["Disposition", persona.disposition || "—"],
          ["Opening", persona.opening ? <q key="o">{persona.opening}</q> : "—"],
          ["Closing", persona.closing ? <q key="c">{persona.closing}</q> : "—"],
        ]}
      />
      <Section title="Grounded in">
        <Lines items={persona.grounded_in} />
      </Section>
    </HudCard>
  );
}
