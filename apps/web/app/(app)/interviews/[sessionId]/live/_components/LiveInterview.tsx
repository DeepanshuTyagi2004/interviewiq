"use client";

import { LiveSessionProvider } from "@/features/interview-live/session/LiveSessionProvider";
import { useLiveSession } from "@/features/interview-live/session/useLiveSession";
import type { LiveSession } from "@/features/interview-live/session/types";
import { ViolationOverlay } from "@/features/interview-live/proctor/ViolationOverlay";
import { PrejoinView } from "./PrejoinView";
import { ChecksView } from "./ChecksView";
import { LiveView } from "./LiveView";
import { EndedView } from "./EndedView";

function LiveInterviewInner({ sessionId }: { sessionId: string }) {
  const { state, session } = useLiveSession();

  switch (state) {
    case "prejoin":
      return <PrejoinView />;
    case "checks":
      return <ChecksView sessionId={sessionId} />;
    case "live":
      return <LiveView sessionId={sessionId} />;
    case "paused":
      return (
        <div className="relative h-full w-full">
          <LiveView sessionId={sessionId} />
          <ViolationOverlay
            session={session}
            onReturn={() => void document.documentElement.requestFullscreen()}
          />
        </div>
      );
    case "ending":
    case "ended":
      return <EndedView sessionId={sessionId} />;
    // connecting / error — real views land in later tasks; a placeholder keeps the
    // state machine wired end-to-end today.
    default:
      return (
        <div className="m-auto text-sm text-muted-foreground">
          {state}&hellip;
        </div>
      );
  }
}

export default function LiveInterview({
  sessionId,
  session,
}: {
  sessionId: string;
  session?: LiveSession;
}) {
  return (
    <LiveSessionProvider sessionId={sessionId} session={session}>
      <div className="fixed inset-0 z-50 flex bg-background">
        <LiveInterviewInner sessionId={sessionId} />
      </div>
    </LiveSessionProvider>
  );
}
