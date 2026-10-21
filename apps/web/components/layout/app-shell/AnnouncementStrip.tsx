"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { ANNOUNCEMENT, dismissAnnouncement, isAnnouncementDismissed, type Announcement } from "./announcement";

/**
 * The 40px strip above the top bar: grainy black, white text, an optional link and a dismiss
 * button. Renders nothing without an announcement, once dismissed, or until storage was read.
 */
export function AnnouncementStrip({ announcement = ANNOUNCEMENT }: { announcement?: Announcement | null }) {
  // null = not checked yet; the server and the first client render show nothing either way.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const id = announcement?.id;

  useEffect(() => {
    setDismissed(id ? isAnnouncementDismissed(id) : true);
  }, [id]);

  if (!announcement || dismissed !== false) return null;

  return (
    <div role="region" aria-label="Announcement" className="iq-strip iq-grain iq-grain-light flex h-10 flex-none items-center justify-center gap-3 px-12 text-[13.5px]">
      <p className="relative z-[1] m-0 min-w-0 truncate">
        {announcement.text}
        {announcement.href ? (
          <>
            {" "}
            <Link
              href={announcement.href}
              className="rounded-sm underline underline-offset-[3px] outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white"
            >
              {announcement.linkText ?? "Learn more"}
            </Link>
          </>
        ) : null}
      </p>
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={() => {
          dismissAnnouncement(announcement.id);
          setDismissed(true);
        }}
        className="absolute right-3 z-[1] flex h-7 w-7 items-center justify-center rounded-full outline-none transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
      >
        <X aria-hidden className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </div>
  );
}
