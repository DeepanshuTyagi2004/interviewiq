"use client";

import { Readout, SegmentMeter, padCount } from "@/components/hud";
import { Panel } from "@/components/patterns";
import { useProfile } from "@/features/profile";
import { PROVIDERS } from "./providers";
import { useResumeImport } from "./useResumeImport";

const NOTES = [
  {
    title: "Optional, always",
    body: "A resume is enough to start. Connected sources just give the interviewer more of your own work to ask about.",
  },
  {
    title: "Public data only",
    body: "We only read public activity from the accounts you connect.",
  },
  {
    title: "Disconnect any time",
    body: "Disconnecting removes the connection and its synced data from your profile. You can reconnect whenever you like.",
  },
];

/** Side panel on Connections: how many live sources are connected, and how sources are used. */
export function ConnectionsAside() {
  const { data } = useProfile();
  const { hasProfile } = useResumeImport();

  const live = PROVIDERS.filter((p) => p.live);
  // The resume's "connection" is the saved candidate profile; the others come from /profile/me.
  const connected = live.filter((p) =>
    p.source === "RESUME" ? hasProfile : Boolean(data?.sources.some((s) => s.source === p.source && s.connected)),
  ).length;

  return (
    <Panel eyebrow="How sources are used" className="lg:sticky lg:top-6">
      <div className="iq-float px-5 py-4">
        {/* The readout and meter restate the sentence below, which is what screen readers get. */}
        <div aria-hidden>
          <Readout label="Sources linked" value={data ? `${padCount(connected)}/${padCount(live.length)}` : "—"} />
        </div>
        <SegmentMeter segments={live.length} filled={data ? connected : 0} tone="brand" size="md" className="mt-3" />
        <p className="sr-only">
          {data ? connected : "—"} of {live.length} available sources connected
        </p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-4 p-0 px-1">
        {NOTES.map((note) => (
          <li key={note.title} className="flex flex-col gap-1">
            <p className="m-0 text-sm">{note.title}</p>
            <p className="m-0 text-[13px] leading-[1.55] text-muted-foreground">{note.body}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
