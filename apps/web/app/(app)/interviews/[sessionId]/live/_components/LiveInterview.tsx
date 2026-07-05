"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LiveSessionProvider } from "@/features/interview-live/session/LiveSessionProvider";
import { useLiveSession } from "@/features/interview-live/session/useLiveSession";
import type { LiveSession } from "@/features/interview-live/session/types";
import { ViolationOverlay } from "@/features/interview-live/proctor/ViolationOverlay";
import { useLiveState } from "@/features/interview/hooks";
import { PrejoinView } from "./PrejoinView";
import { ChecksView } from "./ChecksView";
import { LiveView } from "./LiveView";
import { EndedView } from "./EndedView";

/** Shared full-bleed shell for the loading/redirecting/not-enterable gate states below —
 * mirrors the layout the provider-mounted tree uses so there's no flash of a differently
 * shaped page while the gate resolves. */
function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      {children}
    </div>
  );
}

function LiveInterviewInner({ sessionId }: { sessionId: string }) {
  const { state, session } = useLiveSession();
  const router = useRouter();

  switch (state) {
    case "prejoin":
      return <PrejoinView />;
    case "checks":
      return <ChecksView sessionId={sessionId} />;
    // live + paused share ONE stable tree so LiveView (and the candidate's in-progress
    // code/diagram/tab/media state) is NEVER remounted on a pause/resume. Only the `inert`
    // flag toggles (disables the work area under the overlay) and the overlay renders as a
    // sibling. useProctor's document listeners inside LiveView keep firing while inert, so
    // the restore→resume path still works.
    case "live":
    case "paused":
      return (
        <div className="relative h-full w-full">
          <div inert={state === "paused"} className="h-full w-full">
            <LiveView sessionId={sessionId} />
          </div>
          {state === "paused" && (
            <ViolationOverlay
              session={session}
              onReturn={() => void document.documentElement.requestFullscreen()}
            />
          )}
        </div>
      );
    case "ending":
    case "ended":
      return <EndedView sessionId={sessionId} />;
    case "reconnecting":
      return (
        <div className="m-auto flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Reconnecting&hellip; hang tight, we&apos;re restoring your interview.
          </p>
        </div>
      );
    case "error":
      return (
        <div className="m-auto flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Something went wrong connecting to your interview. You can try again from the
            interviews list.
          </p>
          <Button
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              router.push("/interviews");
            }}
          >
            Back to interviews
          </Button>
        </div>
      );
    // connecting — a real view lands in a later task; a placeholder keeps the state machine
    // wired end-to-end today.
    default:
      return (
        <div className="m-auto text-sm text-muted-foreground">
          {state}&hellip;
        </div>
      );
  }
}

/** Gates the live route on the server's session status before ever mounting the
 * `LiveSessionProvider` — the provider assumes a live-enterable session (it starts its state
 * machine at `prejoin` and immediately wires connection-change listeners), so we must not mount
 * it for a session that's still preparing, already finished, or otherwise not enterable.
 *
 * - `COMPLETED` / `ABORTED_TECHNICAL` (terminal) → redirect to the report. The redirect is
 *   dispatched from an effect (never during render) per the rules-of-react set-state-in-render
 *   restriction.
 * - `PREP_READY` → mount the provider; the machine starts at `prejoin` as before.
 * - `LIVE_IN_PROGRESS` (a refresh/reconnect mid-interview) → MVP: mount the provider the same
 *   way and let the candidate walk back through prejoin → checks → connect. This re-establishes
 *   a live connection but does NOT replay the prior transcript/timeline — a full resume (restoring
 *   the in-progress conversation state) is out of scope for this slice.
 * - anything else (`SCHEDULED`, `PREP_QUEUED`, `PREP_FAILED`, or an unrecognized value) → treated
 *   as not-enterable; show a simple message with a way back rather than guessing at a redirect
 *   target.
 */
export default function LiveInterview({
  sessionId,
  session,
}: {
  sessionId: string;
  session?: LiveSession;
}) {
  const router = useRouter();
  const { data, isLoading, isError } = useLiveState(sessionId);
  const status = data?.status;
  const isTerminal = status === "COMPLETED" || status === "ABORTED_TECHNICAL";
  const isEnterable = status === "PREP_READY" || status === "LIVE_IN_PROGRESS";

  useEffect(() => {
    if (isTerminal) {
      router.push(`/interviews/${sessionId}/report`);
    }
  }, [isTerminal, sessionId, router]);

  if (isLoading) {
    return (
      <GateShell>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </GateShell>
    );
  }

  // The gate's initial fetch (getLive) failed — without this branch a candidate stays on the
  // spinner forever, since `!data` would otherwise fall straight back into the loading render
  // below. Give them the same recovery affordance as the in-session `error` state.
  if (isError) {
    return (
      <GateShell>
        <div className="flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Something went wrong loading your interview. You can try again from the interviews
            list.
          </p>
          <Button onClick={() => router.push("/interviews")}>Back to interviews</Button>
        </div>
      </GateShell>
    );
  }

  if (!data) {
    return (
      <GateShell>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </GateShell>
    );
  }

  if (isTerminal) {
    // The effect above fires the redirect; render a lightweight holding state in the meantime.
    return (
      <GateShell>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </GateShell>
    );
  }

  if (isEnterable) {
    return (
      <LiveSessionProvider sessionId={sessionId} session={session}>
        <div className="fixed inset-0 z-50 flex bg-background">
          <LiveInterviewInner sessionId={sessionId} />
        </div>
      </LiveSessionProvider>
    );
  }

  return (
    <GateShell>
      <div className="flex w-full max-w-md flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          This interview isn&apos;t ready to join yet.
        </p>
        <Button onClick={() => router.push("/interviews")}>Back to interviews</Button>
      </div>
    </GateShell>
  );
}
