"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { enterFullscreen } from "./proctor/keyboardLock";

/** A link into the live room. The click that opens it also asks for full screen (a page can only go full screen
 * from a click), so the room's first page, the instructions, is already full screen. Elsewhere it is a plain Link. */
export function RoomLink({ href, onClick, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (typeof href === "string" && href.endsWith("/live")) void enterFullscreen().catch(() => {});
      }}
      {...rest}
    />
  );
}
