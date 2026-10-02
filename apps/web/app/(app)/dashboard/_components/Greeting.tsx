import Link from "next/link";
import { Button } from "@/components/ui/button";
import { padCount } from "@/components/hud";
import { ROUTES } from "@/lib/constants/shared";

function partOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * "Fri 02 Oct": the day the page was rendered, as a mono readout. Mixed case in the source:
 * `.iq-eyebrow` upper-cases it visually, and screen readers read words rather than spelling out
 * capitals. Date only: a clock time would freeze at render and go stale on an open tab.
 */
export function dateEyebrow(now: Date): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "short" });
  const month = now.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${padCount(now.getDate())} ${month}`;
}

export interface GreetingProps {
  name: string | null | undefined;
  /** One line on where things stand, e.g. "Your Meesho DSA round is ready to join." */
  summary: string;
  /** Where "Enter interview room" goes — the joinable session, else the interviews list. */
  roomHref: string;
  now?: Date;
}

/** Date eyebrow, time-of-day greeting, status line and the two primary actions. */
export function Greeting({ name, summary, roomHref, now = new Date() }: GreetingProps) {
  const firstName = name?.trim().split(/\s+/)[0];
  const hello = partOfDay(now.getHours());

  return (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <p className="iq-eyebrow m-0 tabular-nums">{dateEyebrow(now)}</p>
        <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
          {firstName ? `${hello}, ${firstName}` : hello}
        </h1>
        <p className="m-0 mt-1.5 text-[14px] leading-[1.5] text-muted-foreground">{summary}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="strong" className="h-10 px-4 text-[13.5px]">
          <Link href={ROUTES.jobs}>Browse companies</Link>
        </Button>
        <Button asChild className="h-10 px-4 text-[13.5px]">
          <Link href={roomHref}>Enter interview room</Link>
        </Button>
      </div>
    </div>
  );
}
