"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Send, X } from "lucide-react";
import { ROUTES } from "@/lib/constants/shared";
import { INVITE_KEY, isDismissed, markDismissed } from "./announcement";

/** The dismissible "Bring your college" card. Hidden until storage was read, and once dismissed. */
export function SidebarInvite() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    setDismissed(isDismissed(INVITE_KEY, "1"));
  }, []);

  if (dismissed !== false) return null;

  return (
    <div className="relative mx-0.5 my-2.5 rounded-[14px] border border-line bg-background p-3.5 shadow-ring transition-colors duration-150 hover:bg-surface">
      <span aria-hidden className="mb-2.5 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-surface-2 text-ink">
        <Send className="h-[15px] w-[15px]" strokeWidth={1.8} />
      </span>
      <Link
        href={ROUTES.forColleges}
        className="block rounded-md text-[13.5px] font-medium text-ink outline-none after:absolute after:inset-0 after:rounded-[14px] focus-visible:after:ring-2 focus-visible:after:ring-ink focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
      >
        Bring your college
      </Link>
      <p className="m-0 mt-[3px] text-[12.5px] leading-[1.45] text-ink-3">Invite your placement cell to track batch readiness.</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          markDismissed(INVITE_KEY, "1");
          setDismissed(true);
        }}
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full text-ink-3 outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
      >
        <X aria-hidden className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}
