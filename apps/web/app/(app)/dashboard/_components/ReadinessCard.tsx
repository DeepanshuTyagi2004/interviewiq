import Link from "next/link";
import { ROUTES } from "@/lib/constants/shared";

const SEGMENTS = 4;

/**
 * Readiness for the target role. Loops and readiness levels aren't computed yet, so this shows
 * the empty meter — never a made-up level.
 */
export function ReadinessCard() {
  return (
    <section
      aria-label="Readiness"
      className="flex min-w-0 flex-[1_1_260px] flex-col gap-3.5 rounded-[14px] bg-panel p-5 sm:p-6"
    >
      <p className="iq-eyebrow m-0">Readiness</p>
      <p className="m-0 text-[26px] tracking-[-0.035em] sm:text-[28px]">Not started</p>
      <div aria-hidden className="grid grid-cols-4 gap-1">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className="h-1.5 rounded-[3px] bg-line-4" />
        ))}
      </div>
      <p className="m-0 text-[13px] leading-[1.5] text-muted-foreground">
        Readiness rises as you clear rounds of a role&apos;s official process. Edited loops don&apos;t count.
      </p>
      <Link href={ROUTES.jobs} className="mt-auto self-start text-[13.5px] text-foreground underline underline-offset-[3px]">
        Choose a target role
      </Link>
    </section>
  );
}
