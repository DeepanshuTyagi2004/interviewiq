"use client";

import { HudZoomOff } from "@/components/hud/scope";
import { useSession } from "@/features/interview";
import { isMockMode } from "@/features/interview-live/session/mockMode";
import LiveInterview, { MockRoom } from "./LiveInterview";
import { roomMetaFrom } from "./roomMeta";

/**
 * Route entry for the room: reads the session (company, level, round) purely for display and hands
 * it to `LiveInterview`, which owns the gating, the live session and proctoring unchanged. The room
 * runs at full size: its editors misplace clicks under the app's 90% zoom.
 */
export function LiveRoom({ sessionId }: { sessionId: string }) {
  const { data } = useSession(sessionId);
  const meta = roomMetaFrom(data);
  return (
    <>
      <HudZoomOff />
      {isMockMode() ? <MockRoom sessionId={sessionId} meta={meta} /> : <LiveInterview sessionId={sessionId} meta={meta} />}
    </>
  );
}
