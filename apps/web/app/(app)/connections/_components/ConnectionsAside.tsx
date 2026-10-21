"use client";

import { Card, SegmentBar, Stat } from "@/components/ds";
import { useProfile } from "@/features/profile";
import { PROVIDERS } from "./providers";
import { useResumeImport } from "./useResumeImport";

const NOTES = [
  {
    title: "Optional, always",
    body: "A resume is enough to start. Connected sources just give the interviewer more of your own work to ask about.",
  },
  {
    title: "Your data, your upload",
    body: "Connected accounts provide public activity. LinkedIn uses a PDF you download from your own profile; we never fetch anything from LinkedIn.",
  },
  {
    title: "Disconnect any time",
    body: "Removing a source removes its imported evidence. LinkedIn details you explicitly merged into your editable profile remain there.",
  },
];

/** Side card on Connections: how many live sources are connected, and how sources are used. */
export function ConnectionsAside() {
  const { data } = useProfile();
  const { hasProfile } = useResumeImport();

  const live = PROVIDERS.filter((p) => p.live);
  // The resume's "connection" is the saved candidate profile; the others come from /profile/me.
  const connected = live.filter((p) =>
    p.source === "RESUME" ? hasProfile : Boolean(data?.sources.some((s) => s.source === p.source && s.connected)),
  ).length;

  return (
    <Card title="How sources are used" tone="surface" className="lg:sticky lg:top-[60px]" bodyClassName="flex flex-col gap-6">
      <div>
        {/* The stat and bar restate the sentence below, which is what screen readers get. */}
        <div aria-hidden>
          <Stat label="Sources linked" size="sm" value={data ? connected : "—"} unit={data ? `of ${live.length}` : undefined} />
        </div>
        <SegmentBar segments={live.length} filled={data ? connected : 0} size="md" className="mt-3" />
        <p className="sr-only">
          {data ? connected : "—"} of {live.length} available sources connected
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-4 border-t border-line p-0 pt-5">
        {NOTES.map((note) => (
          <li key={note.title} className="flex flex-col gap-1">
            <p className="m-0 text-sm font-medium">{note.title}</p>
            <p className="m-0 text-[13px] leading-[1.55] text-ink-2">{note.body}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
