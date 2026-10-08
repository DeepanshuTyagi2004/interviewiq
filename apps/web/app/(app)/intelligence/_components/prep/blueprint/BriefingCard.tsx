import { HudCard } from "@/components/hud";
import type { Blueprint } from "@/features/blueprints";
import { Facts } from "../ui";

/** The candidate-safe briefing, exactly as the candidate's session page receives it (spec §5.5, §9.2). */
export function BriefingCard({ briefing }: { briefing: Blueprint["briefing"] }) {
  return (
    <HudCard title="What the candidate sees" spotlight={false} bodyClassName="space-y-3 px-4 py-4 sm:px-5">
      <p className="m-0 text-[13px] text-muted-foreground">
        The only candidate-visible part of the blueprint. It never names topics, problems or difficulty.
      </p>
      <Facts
        items={[
          ["Interviewer", briefing.interviewer_name],
          ["Style", briefing.interviewer_style],
          ["Format", briefing.format],
          ["Duration", `${briefing.duration_mins} min`],
        ]}
      />
    </HudCard>
  );
}
