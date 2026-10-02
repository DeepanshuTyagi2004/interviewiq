import Link from "next/link";
import { HudCard, SegmentMeter } from "@/components/hud";
import { ROUTES } from "@/lib/constants/shared";

/**
 * Readiness for the target role. Loops and readiness levels aren't computed yet, so this shows
 * the empty meter — never a made-up level. Keeps the borderless panel fill (so the notch's
 * diagonal hairline is hidden too: it would be the only stroke on the card).
 */
export function ReadinessCard() {
  return (
    <HudCard
      notch
      title="Readiness"
      aria-label="Readiness"
      className="flex-[1_1_260px] border-transparent bg-panel [&>.hud-notch-line]:hidden"
      bodyClassName="flex flex-col gap-3.5 p-5 sm:p-6"
    >
      <p className="m-0 text-[26px] tracking-[-0.035em] sm:text-[28px]">Not started</p>
      <SegmentMeter segments={4} filled={0} size="md" />
      <p className="m-0 text-[13px] leading-[1.5] text-muted-foreground">
        Readiness rises as you clear rounds of a role&apos;s official process. Edited loops don&apos;t count.
      </p>
      <Link href={ROUTES.jobs} className="mt-auto self-start text-[13.5px] text-foreground underline underline-offset-[3px]">
        Choose a target role
      </Link>
    </HudCard>
  );
}
