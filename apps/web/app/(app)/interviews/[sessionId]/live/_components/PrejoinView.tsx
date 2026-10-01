"use client";

import { useEffect, useRef, useState } from "react";
import { Check, VideoOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCameraPreview } from "@/features/interview-live/media/useCameraPreview";
import { useLiveSession } from "@/features/interview-live/session/useLiveSession";
import { roomEyebrow, type RoomMeta } from "./roomMeta";

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

/** A bordered rule list in the design's pre-check row style. */
function RuleList({ id, title, items, kind }: { id: string; title: string; items: string[]; kind: "do" | "dont" }) {
  const Icon = kind === "do" ? Check : X;
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-[10px] border border-line-2">
      <h2 id={id} className="iq-eyebrow m-0 border-b border-line px-[18px] py-3 font-normal">
        {title}
      </h2>
      <ul className="m-0 list-none p-0">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-3.5 border-b border-line px-[18px] py-3.5 last:border-b-0">
            <span
              aria-hidden
              className="mt-px flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] border border-line-3 text-muted-foreground"
            >
              <Icon className="h-3 w-3" />
            </span>
            <span className="text-[14px] leading-[1.5] text-foreground">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A device row: label + hint on the left, its on/off switch on the right. */
function DeviceRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-line px-[18px] py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-[14.5px] font-normal">
          {label}
        </Label>
        <p className="m-0 text-[12.5px] text-faint">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** Machine state `prejoin`: the room's rules, the agreement, and a camera/mic preview. */
export function PrejoinView({ meta }: { meta?: RoomMeta } = {}) {
  const { send } = useLiveSession();
  const { stream, micOn, camOn, setMicOn, setCamOn } = useCameraPreview();
  const [agreed, setAgreed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-[1120px] items-start gap-8 px-5 py-8 sm:px-8 sm:py-12 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10 lg:gap-14">
        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className="flex flex-col gap-2.5">
            <p className="iq-eyebrow m-0">{roomEyebrow(meta)}</p>
            <h1 className="m-0 text-[32px] font-normal leading-[1.05] tracking-[-0.045em] sm:text-[38px]">
              Before you start
            </h1>
            <p className="m-0 text-[15px] leading-[1.5] text-muted-foreground">
              You&apos;ll be speaking with an AI interviewer. Answer out loud and
              treat this like a real interview loop.
            </p>
          </div>

          <RuleList id="prejoin-dos" title="Do" items={DOS} kind="do" />
          <RuleList id="prejoin-donts" title="Don't" items={DONTS} kind="dont" />

          <div className="flex items-start gap-3.5 rounded-[10px] border border-line-2 px-[18px] py-4">
            <Checkbox
              id="prejoin-terms"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              className="mt-px h-[22px] w-[22px] rounded-[5px] border-foreground shadow-none data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-foreground"
            />
            <Label htmlFor="prejoin-terms" className="text-[14px] font-normal leading-[1.5]">
              I understand the interview runs in full screen, that leaving full
              screen or switching tabs will pause it, and I agree to the rules
              above.
            </Label>
          </div>

          <Button
            className="h-12 w-full text-[14.5px]"
            disabled={!agreed}
            onClick={() => send({ type: "START_CHECKS" })}
          >
            Continue
          </Button>
        </div>

        <div className="flex min-w-0 flex-col gap-3 md:sticky md:top-0">
          <p className="iq-eyebrow m-0">Your camera</p>
          <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-inv">
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            {!camOn ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] text-[#c9c8c3]">
                <VideoOff aria-hidden className="h-5 w-5" />
                Camera is off
              </div>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-[10px] border border-line-2">
            <DeviceRow
              id="prejoin-mic"
              label="Microphone"
              hint="Speak clearly — the interview is spoken"
              checked={micOn}
              onCheckedChange={setMicOn}
            />
            <DeviceRow
              id="prejoin-cam"
              label="Camera"
              hint="Keep your face in frame"
              checked={camOn}
              onCheckedChange={setCamOn}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
