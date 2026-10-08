"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { HudCard } from "@/components/hud";
import { LookPill } from "@/components/observability/ConsoleCard";
import { OUTLINE_PILL } from "@/components/observability/status";
import type { BlueprintSlot } from "@/features/blueprints";
import { cn } from "@/lib/utils/cn";
import { SlotDetail } from "./SlotDetail";

/** Core slots first, then reserves, each in order. */
function sortSlots(slots: BlueprintSlot[]): BlueprintSlot[] {
  return [...slots].sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === "core" ? -1 : 1));
}

/** The blueprint's slots as an accordion; any number can be open at once. */
export function SlotList({ slots, roundType }: { slots: BlueprintSlot[]; roundType: string }) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());
  const baseId = React.useId();
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const sorted = sortSlots(slots);
  const core = slots.filter((s) => s.kind === "core").length;

  return (
    <HudCard title="Slots" spotlight={false} meta={<span>{core} core · {slots.length - core} reserve</span>}>
      <ul className="m-0 list-none divide-y divide-line p-0">
        {sorted.map((slot) => {
          const isOpen = open.has(slot.slot_id);
          const bodyId = `${baseId}-${slot.slot_id}`;
          return (
            <li key={slot.slot_id}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={isOpen ? bodyId : undefined}
                onClick={() => toggle(slot.slot_id)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:px-5"
              >
                <ChevronRight
                  aria-hidden
                  className={cn("h-4 w-4 shrink-0 text-faint transition-transform duration-200 ease-iq motion-reduce:transition-none", isOpen && "rotate-90 text-foreground")}
                />
                <LookPill look={slot.kind === "core" ? { tone: "ink" } : OUTLINE_PILL}>
                  {slot.kind} {slot.order}
                </LookPill>
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{slot.problem.title}</span>
                {slot.problem.difficulty ? <span className="font-mono text-[11.5px] text-muted-foreground">{slot.problem.difficulty}</span> : null}
                <span className="font-mono text-[11.5px] tabular-nums text-faint">{slot.timebox_mins} min</span>
              </button>
              {isOpen ? (
                <div id={bodyId} className="border-t border-line px-4 pb-5 pt-4 sm:pl-12 sm:pr-5">
                  <SlotDetail slot={slot} roundType={roundType} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </HudCard>
  );
}
