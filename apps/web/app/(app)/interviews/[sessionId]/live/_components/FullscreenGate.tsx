"use client";

import { useState } from "react";
import { Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enterFullscreen } from "@/features/interview-live/proctor/keyboardLock";
import { useFullscreen } from "@/features/interview-live/proctor/useFullscreen";
import { RoomCentered, RoomFrame } from "./RoomFrame";
import { roomEyebrow, type RoomMeta } from "./roomMeta";

/**
 * Shows its children only while the browser is full screen. The round runs full screen from the first
 * page, instructions included, and a page can only go full screen from a click, so wherever the
 * candidate arrives without it (a reload, an Esc, a bookmarked link) this asks for that one click.
 */
export function FullscreenGate({ meta, children }: { meta?: RoomMeta; children: React.ReactNode }) {
  const { isFullscreen } = useFullscreen();
  const [blocked, setBlocked] = useState(false);

  if (isFullscreen) return <>{children}</>;

  async function enter() {
    setBlocked(false);
    try {
      await enterFullscreen();
    } catch {
      setBlocked(true);
    }
  }

  return (
    <RoomFrame>
      <RoomCentered className="items-center text-center">
        <p className="iq-eyebrow m-0">{roomEyebrow(meta)}</p>
        <h1 className="m-0 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
          This interview runs in full screen
        </h1>
        <p className="m-0 max-w-md text-[15px] leading-[1.5] text-muted-foreground">
          Go full screen to read the instructions and begin. You stay in full screen until the round ends.
        </p>
        <Button className="h-11 px-5 text-[14px]" onClick={() => void enter()}>
          <Maximize aria-hidden />
          Enter full screen
        </Button>
        {blocked ? (
          <p role="alert" className="m-0 text-[13.5px] text-muted-foreground">
            Your browser blocked full screen. Allow it for this site and try again.
          </p>
        ) : null}
      </RoomCentered>
    </RoomFrame>
  );
}
