import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import { RoomLink } from "@/features/interview-live/RoomLink";

function partOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * "Saturday, 18 October": the day the page was rendered. Date only: a clock time would freeze at
 * render and go stale on an open tab.
 */
export function dateEyebrow(now: Date): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const month = now.toLocaleDateString("en-US", { month: "long" });
  return `${weekday}, ${now.getDate()} ${month}`;
}

export interface GreetingProps {
  name: string | null | undefined;
  /** Where the primary action goes: the joinable session, the next round, a track with a round to book, or the interviews list. */
  roomHref: string;
  /** What the primary action does there. */
  roomLabel?: string;
  now?: Date;
}

/** Date eyebrow, time-of-day greeting and the two header actions. */
export function Greeting({ name, roomHref, roomLabel = "Schedule a round", now = new Date() }: GreetingProps) {
  const firstName = name?.trim().split(/\s+/)[0];
  const hello = partOfDay(now.getHours());

  return (
    <PageHeader
      eyebrow={<span className="tabular-nums">{dateEyebrow(now)}</span>}
      title={firstName ? `${hello}, ${firstName}` : hello}
      actions={
        <>
          <Button asChild variant="secondary">
            <Link href={ROUTES.jobs}>Explore companies</Link>
          </Button>
          <Button asChild>
            <RoomLink href={roomHref}>
              <Plus aria-hidden />
              {roomLabel}
            </RoomLink>
          </Button>
        </>
      }
    />
  );
}
