"use client";

import Link from "next/link";
import { ArrowRight, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { ROUTES } from "@/lib/constants/shared";
import { useRegenerateSession, type InterviewSession } from "@/features/interview";

/**
 * The single next step for a session, as the page's primary (brand) button: join or rejoin the
 * room, retry a failed prep, or open the debrief. Nothing while prep is still pending.
 */
export function SessionAction({ session, className }: { session: InterviewSession; className?: string }) {
  const regenerate = useRegenerateSession();
  const base = `${ROUTES.interviews}/${session.id}`;
  const cls = cn("h-10 px-4 text-[13.5px]", className);

  switch (session.status) {
    case "PREP_READY":
    case "LIVE_IN_PROGRESS":
      return (
        <Button asChild className={cls}>
          <Link href={`${base}/live`}>
            {session.status === "LIVE_IN_PROGRESS" ? "Rejoin interview room" : "Enter interview room"}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      );
    case "PREP_FAILED":
      return (
        <Button
          className={cls}
          disabled={regenerate.isPending}
          onClick={() =>
            regenerate.mutate(session.id, {
              onSuccess: () => toast.success("Retrying prep…"),
              onError: () => toast.error("Couldn't retry prep. Please try again."),
            })
          }
        >
          <RotateCw aria-hidden data-motion className={cn(regenerate.isPending && "animate-spin")} />
          Retry prep
        </Button>
      );
    case "COMPLETED":
    case "ABORTED_TECHNICAL":
      return (
        <Button asChild className={cls}>
          <Link href={`${base}/report`}>
            Open debrief
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      );
    default:
      return null;
  }
}
