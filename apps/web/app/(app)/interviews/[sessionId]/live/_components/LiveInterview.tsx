"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LiveSessionProvider } from "@/features/interview-live/session/LiveSessionProvider";
import { useLiveSession } from "@/features/interview-live/session/useLiveSession";
import type { LiveSession } from "@/features/interview-live/session/types";
import { ViolationOverlay } from "@/features/interview-live/proctor/ViolationOverlay";
import { useLiveState, useSession } from "@/features/interview/hooks";
import type { SessionStatus } from "@/features/interview/types";
import { StatusPill } from "../../../_components/StatusPill";
import { RoomCentered, RoomFrame } from "./RoomFrame";
import { roomEyebrow, type RoomMeta } from "./roomMeta";
import { PrejoinView } from "./PrejoinView";
import { ChecksView } from "./ChecksView";
import { LiveView } from "./LiveView";
import { EndedView } from "./EndedView";

/** Shared full-bleed shell for the loading/redirecting/not-enterable gate states below —
 * mirrors the layout the provider-mounted tree uses so there's no flash of a differently
 * shaped page while the gate resolves. */
function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex bg-frame">
      <RoomFrame leave={false}>
        <RoomCentered className="items-center text-center">{children}</RoomCentered>
      </RoomFrame>
    </div>
  );
}

/** Quiet spinner for the in-between states (loading, redirecting, connecting). */
function RoomSpinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3">
      <Loader2 aria-hidden data-motion className="h-6 w-6 animate-spin text-faint" />
      <p className="m-0 text-[13.5px] text-muted-foreground">{label}</p>
    </div>
  );
}

/** Why a not-yet-enterable session can't be joined, from its prep status. */
function notReadyNote(status: SessionStatus | undefined): string {
  if (status === "PREP_READY") return "Your interviewer is ready. Live sessions open soon; we'll let you in from here once they do.";
  if (status === "SCHEDULED") return "We're preparing your interviewer. Come back once it reads Ready.";
  if (status === "PREP_QUEUED") return "Your interviewer is still being prepared. Check back shortly.";
  if (status === "PREP_FAILED") return "Prep for this interview failed. Retry it from the interview's page.";
  return "Come back once your interview reads Ready.";
}

function LiveInterviewInner({ sessionId, meta }: { sessionId: string; meta?: RoomMeta }) {
  const { state, session } = useLiveSession();
  const router = useRouter();

  switch (state) {
    case "prejoin":
      return (
        <RoomFrame>
          <PrejoinView meta={meta} />
        </RoomFrame>
      );
    case "checks":
      return (
        <RoomFrame>
          <ChecksView sessionId={sessionId} meta={meta} />
        </RoomFrame>
      );
    // live + paused share ONE stable tree so LiveView (and the candidate's in-progress
    // code/diagram/tab/media state) is NEVER remounted on a pause/resume. Only the `inert`
    // flag toggles (disables the work area under the overlay) and the overlay renders as a
    // sibling. useProctor's document listeners inside LiveView keep firing while inert, so
    // the restore→resume path still works.
    case "live":
    case "paused":
      return (
        <RoomFrame variant="live">
          <div className="relative flex min-h-0 w-full flex-1 flex-col">
            <div inert={state === "paused"} className="flex min-h-0 w-full flex-1 flex-col">
              <LiveView sessionId={sessionId} meta={meta} />
            </div>
            {state === "paused" && (
              <ViolationOverlay
                session={session}
                onReturn={() => void document.documentElement.requestFullscreen()}
              />
            )}
          </div>
        </RoomFrame>
      );
    case "ending":
    case "ended":
      return (
        <RoomFrame leave={false}>
          <EndedView sessionId={sessionId} meta={meta} />
        </RoomFrame>
      );
    case "reconnecting":
      return (
        <RoomFrame leave={false}>
          <RoomCentered className="items-center text-center">
            <RoomSpinner label="Reconnecting… hang tight, we're restoring your interview." />
          </RoomCentered>
        </RoomFrame>
      );
    case "error":
      return (
        <RoomFrame leave={false}>
          <RoomCentered className="items-center text-center">
            <p className="iq-eyebrow m-0">{roomEyebrow(meta)}</p>
            <p className="m-0 max-w-md text-[15px] leading-[1.5] text-muted-foreground">
              Something went wrong connecting to your interview. You can try again from the
              interviews list.
            </p>
            <Button
              className="h-10 px-4 text-[13.5px]"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                router.push("/interviews");
              }}
            >
              Back to interviews
            </Button>
          </RoomCentered>
        </RoomFrame>
      );
    // connecting — a real view lands in a later task; a placeholder keeps the state machine
    // wired end-to-end today.
    default:
      return (
        <RoomFrame leave={false}>
          <RoomCentered className="items-center text-center">
            <RoomSpinner label={state === "connecting" ? "Connecting to your interviewer…" : `${state}…`} />
          </RoomCentered>
        </RoomFrame>
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
 * - `PREP_READY` → mount the provider (the machine starts at `prejoin`) once the live interviewer is
 *   available (`InterviewSession.liveAvailable`); until then it's not-enterable with an "opens soon" note.
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
  meta,
}: {
  sessionId: string;
  session?: LiveSession;
  /** Display-only session facts (company, level, round) for the room's eyebrows and header. */
  meta?: RoomMeta;
}) {
  const router = useRouter();
  const { data, isLoading: liveLoading, isError } = useLiveState(sessionId);
  // A ready round can only be entered once the live interviewer is available (server-enforced too).
  const { data: sessionInfo, isLoading: sessionLoading } = useSession(sessionId);
  const isLoading = liveLoading || sessionLoading;
  const status = data?.status;
  const isTerminal = status === "COMPLETED" || status === "ABORTED_TECHNICAL";
  const isEnterable = status === "LIVE_IN_PROGRESS" || (status === "PREP_READY" && sessionInfo?.liveAvailable === true);

  useEffect(() => {
    if (isTerminal) {
      router.push(`/interviews/${sessionId}/report`);
    }
  }, [isTerminal, sessionId, router]);

  if (isLoading) {
    return (
      <GateShell>
        <RoomSpinner label="Opening your interview room…" />
      </GateShell>
    );
  }

  // The gate's initial fetch (getLive) failed — without this branch a candidate stays on the
  // spinner forever, since `!data` would otherwise fall straight back into the loading render
  // below. Give them the same recovery affordance as the in-session `error` state.
  if (isError) {
    return (
      <GateShell>
        <p className="iq-eyebrow m-0">{roomEyebrow(meta)}</p>
        <p className="m-0 max-w-md text-[15px] leading-[1.5] text-muted-foreground">
          Something went wrong loading your interview. You can try again from the interviews
          list.
        </p>
        <Button className="h-10 px-4 text-[13.5px]" onClick={() => router.push("/interviews")}>
          Back to interviews
        </Button>
      </GateShell>
    );
  }

  if (!data) {
    return (
      <GateShell>
        <RoomSpinner label="Opening your interview room…" />
      </GateShell>
    );
  }

  if (isTerminal) {
    // The effect above fires the redirect; render a lightweight holding state in the meantime.
    return (
      <GateShell>
        <RoomSpinner label="This round is over. Opening its debrief…" />
      </GateShell>
    );
  }

  if (isEnterable) {
    return (
      <LiveSessionProvider sessionId={sessionId} session={session}>
        <div className="fixed inset-0 z-50 flex bg-frame">
          <LiveInterviewInner sessionId={sessionId} meta={meta} />
        </div>
      </LiveSessionProvider>
    );
  }

  return (
    <GateShell>
      <p className="iq-eyebrow m-0">{roomEyebrow(meta)}</p>
      {status ? <StatusPill status={status} /> : null}
      <h1 className="m-0 text-[28px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[32px]">
        This interview isn&apos;t ready to join yet.
      </h1>
      <p className="m-0 max-w-md text-[15px] leading-[1.5] text-muted-foreground">{notReadyNote(status)}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button className="h-10 px-4 text-[13.5px]" onClick={() => router.push("/interviews")}>
          Back to interviews
        </Button>
        <Button asChild variant="strong" className="h-10 px-4 text-[13.5px]">
          <Link href={`/interviews/${sessionId}`}>View interview</Link>
        </Button>
      </div>
    </GateShell>
  );
}
