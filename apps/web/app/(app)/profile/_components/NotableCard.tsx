import { MonoPill } from "@/components/patterns";
import type { NotableItem } from "@/features/profile";
import { PROVIDERS } from "@/app/(app)/connections/_components/providers";
import { CardEmpty, ProfileCard } from "./ProfileCard";

const SOURCE_LABEL = new Map(PROVIDERS.map((p) => [p.source, p.label]));

export interface NotableCardProps {
  notable: NotableItem[];
}

/**
 * Notable items from the resume and connected sources, each tagged with the source it came from.
 * Describes what the data shows; never grades or compares.
 */
export function NotableCard({ notable }: NotableCardProps) {
  if (!notable.length) {
    return (
      <ProfileCard title="Notable">
        <CardEmpty
          title="No highlights yet."
          hint="They’re written from your resume and connected accounts once they’ve been read."
        />
      </ProfileCard>
    );
  }

  return (
    <ProfileCard title="Notable">
      <ul className="m-0 flex list-none flex-col px-4 py-4 sm:px-5 sm:py-5">
        {notable.map((n, i) => (
          <li
            key={i}
            className="flex items-start justify-between gap-4 border-t border-line py-2.5 text-sm leading-[1.5] first:border-t-0 first:pt-0 last:pb-0"
          >
            <span className="min-w-0">{n.text}</span>
            <MonoPill tone="soft" className="mt-0.5 flex-none">
              <span className="sr-only">Source: </span>
              {SOURCE_LABEL.get(n.source) ?? n.source}
            </MonoPill>
          </li>
        ))}
      </ul>
    </ProfileCard>
  );
}
