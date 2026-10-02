"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { StatusDot, type DotState } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useExternalDisplay } from "@/features/interview-live/proctor/useExternalDisplay";
import { useLiveSession } from "@/features/interview-live/session/useLiveSession";
import { RoomCentered } from "./RoomFrame";
import { roomEyebrow, type RoomMeta } from "./roomMeta";

type CheckStatus = "checking" | "pass" | "warn" | "fail";

/** Each check state as a status dot + its word. Only a check that's really running pulses. */
const CHECK_DOT: Record<CheckStatus, { label: string; state: DotState; tone: string }> = {
  checking: { label: "Checking", state: "live", tone: "text-muted-foreground" },
  pass: { label: "OK", state: "active", tone: "text-foreground" },
  warn: { label: "Warning", state: "warn", tone: "text-foreground" },
  fail: { label: "Action needed", state: "error", tone: "text-destructive" },
};

/** One check as a mono readout row (`MICROPHONE ──── ● OK`) over its detail message. */
function CheckRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: CheckStatus;
  detail: string;
}) {
  const dot = CHECK_DOT[status];
  return (
    <li className="flex flex-col gap-1.5 border-b border-line px-[18px] py-4 last:border-b-0">
      <div className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.06em]">
        <p className="m-0 min-w-0 text-foreground">{label}</p>
        <span aria-hidden className="h-px min-w-4 flex-1 bg-line-2" />
        <StatusDot state={dot.state} label={dot.label} className={cn("text-[12px] tracking-[0.06em]", dot.tone)} />
      </div>
      <p className="m-0 text-[12.5px] leading-[1.5] text-muted-foreground">{detail}</p>
    </li>
  );
}

/** Runs system checks (mic, camera, external display) for machine state `checks`, then on
 * **Enter interview** (a user gesture) requests fullscreen, hands off to `checks`→`connecting`,
 * connects the session, and once connected hands off to `connecting`→`live`.
 *
 * Mic/camera each get their own getUserMedia({ audio } / { video }) probe — independent calls so
 * one being denied doesn't fail the other's result — and stop their tracks immediately after
 * reading track presence; the session acquires its own (kept-open) stream later, in connect(). */
export function ChecksView({ sessionId, meta }: { sessionId: string; meta?: RoomMeta }) {
  const { session, send } = useLiveSession();
  const { extended, supported } = useExternalDisplay();
  const [micStatus, setMicStatus] = useState<CheckStatus>("checking");
  const [camStatus, setCamStatus] = useState<CheckStatus>("checking");
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setMicStatus(stream.getAudioTracks().length > 0 ? "pass" : "fail");
        stream.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {
        if (!cancelled) setMicStatus("fail");
      });

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setCamStatus(stream.getVideoTracks().length > 0 ? "pass" : "fail");
        stream.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {
        if (!cancelled) setCamStatus("fail");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // External-display detection is best-effort (Window Management API, Chromium-only) — an
  // extended display is a WARNING, never a hard block, per spec §7.
  const displayStatus: CheckStatus = !supported
    ? "pass"
    : extended === true
      ? "warn"
      : extended === false
        ? "pass"
        : "checking";
  const displayDetail = !supported
    ? "Extended-display detection isn't available in this browser — proceeding as normal."
    : extended === true
      ? "A second/extended display was detected. For interview integrity, please disconnect it if you can."
      : extended === false
        ? "No extended display detected."
        : "Checking for a connected external display…";

  const ready = micStatus === "pass" && camStatus === "pass";

  async function handleEnter() {
    setEntering(true);
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setEntering(false);
      return;
    }
    // Hands off checks → connecting; ChecksView unmounts once LiveInterview re-renders for the
    // new state, so nothing after this point may rely on this component still being mounted.
    send({ type: "CHECKS_PASSED" });
    try {
      await session.connect(sessionId);
      if (session.connectionState === "connected") {
        send({ type: "CONNECTED" });
      } else {
        // connect() resolved but session never reached connected state — treat as failure
        send({ type: "ERROR" });
      }
    } catch {
      // Connection failed after checks already passed — send ERROR to move state machine
      // from connecting to error state so the error placeholder renders.
      send({ type: "ERROR" });
    }
  }

  const blocked = micStatus === "fail" || camStatus === "fail";

  return (
    <RoomCentered>
      <div className="flex flex-col gap-2.5">
        <p className="iq-eyebrow m-0">{roomEyebrow(meta)}</p>
        <h1 className="m-0 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
          System check
        </h1>
        <p className="m-0 text-[15px] leading-[1.5] text-muted-foreground">
          We run a quick check before entering the interview. Entering switches to full screen;
          leaving it pauses the round.
        </p>
      </div>

      <ul aria-label="System checks" className="m-0 list-none overflow-hidden rounded-[14px] border border-line-2 p-0">
        <CheckRow
          label="Microphone"
          status={micStatus}
          detail={
            micStatus === "checking"
              ? "Checking microphone access…"
              : micStatus === "pass"
                ? "Microphone detected and accessible."
                : "No microphone detected, or access was denied. Connect a microphone and allow access."
          }
        />
        <CheckRow
          label="Camera"
          status={camStatus}
          detail={
            camStatus === "checking"
              ? "Checking camera access…"
              : camStatus === "pass"
                ? "Camera detected and accessible."
                : "No camera detected, or access was denied. Connect a camera and allow access."
          }
        />
        <CheckRow label="External display" status={displayStatus} detail={displayDetail} />
      </ul>

      <Button
        className="h-12 w-full text-[14.5px]"
        disabled={!ready || entering}
        onClick={() => void handleEnter()}
      >
        {entering ? <Loader2 aria-hidden data-motion className="animate-spin" /> : null}
        Enter interview
      </Button>
      {blocked ? (
        <p role="status" className="m-0 text-center text-[13px] leading-[1.5] text-muted-foreground">
          Allow microphone and camera access in your browser&apos;s site settings, then reload this page.
        </p>
      ) : null}
    </RoomCentered>
  );
}
