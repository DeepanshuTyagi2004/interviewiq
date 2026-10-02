import Link from "next/link";
import { HudCard, SegmentMeter } from "@/components/hud";
import { ROUTES } from "@/lib/constants/shared";

/**
 * Readiness for the target role. Loops and readiness levels aren't computed yet, so this shows
 * the empty meter — never a made-up level. Sizes follow `--u` (the dashboard fits the viewport).
 */
export function ReadinessCard({ className }: { className?: string }) {
  return (
    <HudCard
      notch
      glow="bl"
      title="Readiness"
      aria-label="Readiness"
      className={className}
      bodyClassName="flex flex-col gap-[calc(16*var(--u))] px-[calc(18*var(--u))] py-[calc(24*var(--u))] sm:px-[calc(26*var(--u))]"
    >
      <p className="m-0 text-[length:calc(34*var(--u))] leading-[1.1] tracking-[-0.035em]">Not started</p>
      <SegmentMeter segments={4} filled={0} size="md" className="mt-[calc(4*var(--u))]" />
      <p className="m-0 text-[length:calc(16*var(--u))] leading-[1.55] text-muted-foreground">
        Readiness rises as you clear rounds of a role&apos;s official process. Edited loops don&apos;t count.
      </p>
      <Link
        href={ROUTES.jobs}
        className="mt-auto self-start text-[length:calc(16*var(--u))] text-foreground underline underline-offset-[calc(4*var(--u))]"
      >
        Choose a target role
      </Link>
    </HudCard>
  );
}
