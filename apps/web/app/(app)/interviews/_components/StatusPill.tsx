import { AlertTriangle, CalendarClock, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SESSION_STATUS_META } from "@/lib/constants/interview";
import type { SessionStatus } from "@/features/interview";

const TONE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  neutral: "outline",
  pending: "secondary",
  ready: "default",
  failed: "destructive",
};

/** Vercel-style status pill for a session's prep state. */
export function StatusPill({ status }: { status: SessionStatus }) {
  const meta = SESSION_STATUS_META[status] ?? SESSION_STATUS_META.SCHEDULED;
  const Icon =
    meta.tone === "ready"
      ? CheckCircle2
      : meta.tone === "failed"
        ? AlertTriangle
        : meta.tone === "pending"
          ? Loader2
          : CalendarClock;
  return (
    <Badge variant={TONE_VARIANT[meta.tone]} className="gap-1.5">
      <Icon className={meta.tone === "pending" ? "size-3 animate-spin" : "size-3"} />
      {meta.label}
    </Badge>
  );
}
