import { MonoPill } from "@/components/patterns";
import type { NotableItem } from "@/features/profile";
import { PROVIDERS } from "@/app/(app)/connections/_components/providers";
import { CardEmpty, ProfileCard } from "./ProfileCard";

const SOURCE_LABEL = new Map(PROVIDERS.map((p) => [p.source, p.label]));

export interface SummaryCardProps {
  atAGlance: string[];
  notable: NotableItem[];
}

/**
 * The descriptive summary: "at a glance" bullets and notable items, each notable item tagged with
 * the source it came from. Describes what the data shows; never grades or compares.
 */
export function SummaryCard({ atAGlance, notable }: SummaryCardProps) {
  if (!atAGlance.length && !notable.length) {
    return (
      <ProfileCard title="At a glance">
        <CardEmpty
          title="No highlights yet"
          hint="Connect a source to see your highlights. They’re written from your résumé and connected accounts."
        />
      </ProfileCard>
    );
  }

  return (
    <ProfileCard title="At a glance">
      <div className="flex flex-col gap-5 px-4 py-4 sm:px-5 sm:py-5">
        {atAGlance.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm leading-[1.5]">
            {atAGlance.map((item, i) => (
              <li key={i} className="flex gap-2.5">
                <span aria-hidden className="mt-[9px] h-1 w-1 flex-none rounded-full bg-faint" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {notable.length ? (
          <div className="flex flex-col gap-2.5">
            <p className="iq-eyebrow m-0">Notable</p>
            <ul className="m-0 flex list-none flex-col p-0">
              {notable.map((n, i) => (
                <li
                  key={i}
                  className="flex items-start justify-between gap-4 border-t border-line py-2.5 text-sm leading-[1.5] first:border-t-0 first:pt-0"
                >
                  <span className="min-w-0">{n.text}</span>
                  <MonoPill tone="soft" className="mt-0.5 flex-none">
                    <span className="sr-only">Source: </span>
                    {SOURCE_LABEL.get(n.source) ?? n.source}
                  </MonoPill>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </ProfileCard>
  );
}
