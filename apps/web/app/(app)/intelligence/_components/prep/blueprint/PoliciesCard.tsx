import { HudCard } from "@/components/hud";
import { LookPill } from "@/components/observability/ConsoleCard";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { GHOST_PILL } from "@/components/observability/status";
import type { Blueprint } from "@/features/blueprints";
import { lookFor } from "../../pills";
import { Facts } from "../ui";
import { DECISION_LOOK } from "../vocabulary";

/** Stage 7: how the interviewer handles candidate requests, plus the four guidance strings. */
export function PoliciesCard({ policies }: { policies: Blueprint["policies"] }) {
  const requests = policies.requests ?? [];
  return (
    <HudCard title="Policies" spotlight={false} meta={<span>{policies.version ?? "no version"}</span>} bodyClassName="flex flex-col">
      {requests.length ? (
        <HairlineTable label="Request policies" className="min-w-[560px] text-[12.5px]">
          <HairlineHead>
            <Th>Request</Th>
            <Th>Decision</Th>
            <Th>How</Th>
          </HairlineHead>
          <tbody>
            {requests.map((r, i) => (
              <Tr key={`${r.kind}-${i}`}>
                <Td className="whitespace-nowrap py-2 align-top font-mono text-[12px]">{r.kind ?? "—"}</Td>
                <Td className="py-2 align-top">
                  <LookPill look={lookFor(DECISION_LOOK, r.decision, GHOST_PILL)}>{r.decision ?? "—"}</LookPill>
                </Td>
                <Td className="py-2 align-top leading-[1.5] text-muted-foreground">{r.how || "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </HairlineTable>
      ) : (
        <p className="m-0 px-4 py-3 text-xs text-faint sm:px-5">No request policies.</p>
      )}
      <div className="border-t border-line px-4 py-4 sm:px-5">
        <Facts
          items={[
            ["Off topic", policies.off_topic || "—"],
            ["Time management", policies.time_management || "—"],
            ["Integrity", policies.integrity || "—"],
            ["Fallback", policies.fallback || "—"],
          ]}
        />
      </div>
    </HudCard>
  );
}
