"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession } from "@/features/interview";
import { RetryPrepButton } from "../../_components/RetryPrepButton";
import { RoomLink } from "@/features/interview-live/RoomLink";

/**
 * The single next step for a session, as the page's primary (ink) button: join or rejoin the
 * room, retry a failed prep, or open the debrief. Nothing while prep is still pending. A ready round
 * can't be joined until the live interviewer is available (`liveAvailable`), so the button is off.
 */
export function SessionAction({ session, className }: { session: InterviewSession; className?: string }) {
  const base = `${ROUTES.interviews}/${session.id}`;
  const cls = cn(className);

  switch (session.status) {
    case "PREP_READY":
      if (!session.liveAvailable) {
        return (
          <Button className={cls} disabled title="Live sessions open soon">
            Enter interview room
            <ArrowRight aria-hidden />
          </Button>
        );
      }
    // falls through
    case "LIVE_IN_PROGRESS":
      return (
        <Button asChild className={cls}>
          <RoomLink href={`${base}/live`}>
            {session.status === "LIVE_IN_PROGRESS" ? "Rejoin interview room" : "Enter interview room"}
            <ArrowRight aria-hidden />
          </RoomLink>
        </Button>
      );
    case "PREP_FAILED":
      return <RetryPrepButton session={session} className={cls} />;
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
