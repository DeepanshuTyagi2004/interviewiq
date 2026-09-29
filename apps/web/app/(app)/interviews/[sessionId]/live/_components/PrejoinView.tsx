"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCameraPreview } from "@/features/interview-live/media/useCameraPreview";
import { useLiveSession } from "@/features/interview-live/session/useLiveSession";

const DOS = [
  "Find a quiet, well-lit space with a stable internet connection.",
  "Speak your answers out loud, just like you would in a real interview.",
  "Take a moment to think before answering — the interviewer will wait.",
];

const DONTS = [
  "Don't exit full screen or switch tabs — the interview pauses and the switch is logged.",
  "Don't use a phone, second monitor, or another person for help.",
  "Don't refresh or close this tab once the interview has started.",
];

export function PrejoinView() {
  const { send } = useLiveSession();
  const { stream, micOn, camOn, setMicOn, setCamOn } = useCameraPreview();
  const [agreed, setAgreed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="flex w-full flex-col overflow-y-auto md:flex-row">
      <div className="flex w-full flex-col gap-6 p-8 md:w-1/2">
        <div>
          <h1 className="text-2xl font-semibold">Before you begin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You&apos;ll be speaking with an AI interviewer. Answer out loud and
            treat this like a real interview loop.
          </p>
        </div>

        <section>
          <h2 className="text-sm font-medium">Do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {DOS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-medium">Don&apos;t</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {DONTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <div className="flex items-start gap-2">
          <Checkbox
            id="prejoin-terms"
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
          />
          <Label htmlFor="prejoin-terms" className="text-sm font-normal">
            I understand the interview runs in full screen, that leaving full
            screen or switching tabs will pause it, and I agree to the rules
            above.
          </Label>
        </div>

        <Button
          className="mt-auto w-full md:w-auto"
          disabled={!agreed}
          onClick={() => send({ type: "START_CHECKS" })}
        >
          Continue
        </Button>
      </div>

      <div className="flex w-full flex-col items-center justify-center gap-4 bg-muted/40 p-8 md:w-1/2">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="aspect-video w-full max-w-md rounded-lg bg-black object-cover"
        />

        <div className="flex w-full max-w-md items-center justify-between rounded-md border bg-background p-3">
          <Label htmlFor="prejoin-mic" className="text-sm font-normal">
            Microphone
          </Label>
          <Switch id="prejoin-mic" checked={micOn} onCheckedChange={setMicOn} />
        </div>

        <div className="flex w-full max-w-md items-center justify-between rounded-md border bg-background p-3">
          <Label htmlFor="prejoin-cam" className="text-sm font-normal">
            Camera
          </Label>
          <Switch id="prejoin-cam" checked={camOn} onCheckedChange={setCamOn} />
        </div>
      </div>
    </div>
  );
}
