"use client";

import { Card } from "@/components/ds";
import type { RoundReport } from "@/features/report";
import { MomentLink } from "./MomentLink";
import { parseTurnRef } from "./turnRef";

/** Observations with examples, never a label. Read from words and timing only. */
export function DeliverySection({ report }: { report: RoundReport }) {
  const observations = report.delivery?.observations ?? [];
  return (
    <Card flush title="Delivery" meta="Based on what you said and when — we don't analyse your voice or accent." headerClassName="pb-4">
      {observations.length === 0 ? (
        <p className="m-0 border-t border-line px-5 py-4 text-[13.5px] text-ink-3">Nothing stood out in how you delivered your answers.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {observations.map((o, i) => {
            const turns = (o.examples ?? []).map(parseTurnRef).filter((t): t is number => t !== null);
            return (
              <li key={i} className="border-t border-line px-5 py-4">
                <p className="m-0 max-w-[68ch] text-[14px] leading-[1.6]">{o.text}</p>
                {turns.length > 0 ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12.5px] text-ink-3">Examples</span>
                    {turns.map((t) => (
                      <MomentLink key={t} turnId={t} />
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
