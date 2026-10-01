import { Loader2 } from "lucide-react";
import { MonoPill } from "@/components/patterns";
import { cn } from "@/lib/utils/cn";
import { statusMeta } from "@/features/interview/presentation";
import type { SessionStatus } from "@/features/interview";

/**
 * A session's state as the design's mono pill: "READY" in ink, "LIVE" in ink with a breathing
 * brand dot, "PREP FAILED" in the alert tone, and a small spinner while prep is running
 * ("PREPARING").
 */
export function StatusPill({ status, className }: { status: SessionStatus; className?: string }) {
  const meta = statusMeta(status);
  return (
    <MonoPill tone={meta.tone} className={cn("gap-1.5", className)}>
      {meta.pending ? <Loader2 aria-hidden data-motion className="h-2.5 w-2.5 animate-spin" /> : null}
      {meta.live ? (
        <span aria-hidden data-motion className="h-1.5 w-1.5 animate-[iq-breathe_1.4s_ease-in-out_infinite] rounded-full bg-brand" />
      ) : null}
      {meta.label}
    </MonoPill>
  );
}
