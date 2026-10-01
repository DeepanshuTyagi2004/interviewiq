"use client";

import { useSession } from "@/features/interview";
import LiveInterview from "./LiveInterview";
import { roomMetaFrom } from "./roomMeta";

/**
 * Route entry for the room: reads the session (company, level, round) purely for display and hands
 * it to `LiveInterview`, which owns the gating, the live session and proctoring unchanged.
 */
export function LiveRoom({ sessionId }: { sessionId: string }) {
  const { data } = useSession(sessionId);
  return <LiveInterview sessionId={sessionId} meta={roomMetaFrom(data)} />;
}
