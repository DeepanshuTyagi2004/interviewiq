"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useExternalDisplay } from "@/features/interview-live/proctor/useExternalDisplay";
import { useLiveSession } from "@/features/interview-live/session/useLiveSession";

type CheckStatus = "checking" | "pass" | "warn" | "fail";

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
    status === "pass" ? CheckCircle2 : status === "checking" ? Loader2 : AlertTriangle;
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Icon
        className={cn(
          "mt-0.5 h-5 w-5 shrink-0",
          status === "pass" && "text-green-600",
          status === "fail" && "text-destructive",
          status === "warn" && "text-amber-500",
          status === "checking" && "animate-spin text-muted-foreground",
        )}
      />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

/** Runs system checks (mic, camera, external display) for machine state `checks`, then on
 * **Enter interview** (a user gesture) requests fullscreen, hands off to `checks`→`connecting`,
 * connects the session, and once connected hands off to `connecting`→`live`.
 *
 * Mic/camera each get their own getUserMedia({ audio } / { video }) probe — independent calls so
 * one being denied doesn't fail the other's result — and stop their tracks immediately after
 * reading track presence; the session acquires its own (kept-open) stream later, in connect(). */
export function ChecksView({ sessionId }: { sessionId: string }) {
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

  return (
    <div className="m-auto flex w-full max-w-lg flex-col gap-4 p-8">
      <div>
        <h1 className="text-2xl font-semibold">System check</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We run a quick check before entering the interview.
        </p>
      </div>

      <div className="flex flex-col gap-3">
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
      </div>

      <Button
        className="mt-2 w-full"
        disabled={!ready || entering}
        onClick={() => void handleEnter()}
      >
        Enter interview
      </Button>
    </div>
  );
}
