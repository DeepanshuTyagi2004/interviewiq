"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonoPill } from "@/components/patterns";
import { cn } from "@/lib/utils/cn";
import { useExternalDisplay } from "@/features/interview-live/proctor/useExternalDisplay";
import { useLiveSession } from "@/features/interview-live/session/useLiveSession";
import { RoomCentered } from "./RoomFrame";
import { roomEyebrow, type RoomMeta } from "./roomMeta";

type CheckStatus = "checking" | "pass" | "warn" | "fail";

const STATUS_PILL: Record<CheckStatus, { label: string; tone: "ghost" | "soft" | "ink" | "alert" }> = {
  checking: { label: "Checking", tone: "ghost" },
  pass: { label: "OK", tone: "soft" },
  warn: { label: "Warning", tone: "ink" },
  fail: { label: "Action needed", tone: "alert" },
};

/** One check in the design's pre-check row style: a square mark, the check, and its status. */
function CheckRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: CheckStatus;
  detail: string;
}) {
  const Icon =
    status === "pass" ? Check : status === "checking" ? Loader2 : status === "warn" ? AlertTriangle : X;
  return (
    <li className="flex items-start gap-3.5 border-b border-line px-[18px] py-4 last:border-b-0">
      <span
        aria-hidden
        className={cn(
          "mt-px flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] border",
          status === "pass" && "border-brand bg-brand text-brand-foreground",
          status === "checking" && "border-line-4 text-faint",
          status === "warn" && "border-foreground text-foreground",
          status === "fail" && "border-destructive/50 bg-destructive/10 text-destructive",
        )}
      >
        <Icon data-motion className={cn("h-3 w-3", status === "checking" && "animate-spin")} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[14.5px]">{label}</p>
        <p className="m-0 text-[12.5px] leading-[1.5] text-muted-foreground">{detail}</p>
      </div>
      <MonoPill tone={STATUS_PILL[status].tone} className="mt-0.5">
        {STATUS_PILL[status].label}
      </MonoPill>
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
        <h1 className="m-0 text-[32px] font-normal leading-[1.05] tracking-[-0.045em] sm:text-[38px]">
          System check
        </h1>
        <p className="m-0 text-[15px] leading-[1.5] text-muted-foreground">
          We run a quick check before entering the interview. Entering switches to full screen;
          leaving it pauses the round.
        </p>
      </div>

      <ul aria-label="System checks" className="m-0 list-none overflow-hidden rounded-[10px] border border-line-2 p-0">
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
