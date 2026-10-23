import { cn } from "@/lib/utils/cn";
import { CONTAINER } from "./primitives";
import { PersonaCarousel } from "./PersonaCarousel";

/** "Mock interviews, whenever you're ready" — the big 24/7 and the audience carousel. */
export function Personas() {
  return (
    <section className={cn(CONTAINER, "pt-24 sm:pt-[140px]")}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-[380px] flex-col gap-3.5">
          <h2 data-reveal className="iq-h2">
            Mock interviews, whenever you&apos;re ready
          </h2>
          <p className="m-0 text-[15px] leading-[1.5] text-muted-foreground">
            No waiting for a senior, a coach or a slot. Unlimited practice, on your schedule.
          </p>
        </div>
        <p
          data-reveal
          className="m-0 text-[clamp(96px,17vw,240px)] font-semibold leading-[0.8] tracking-[-0.06em]"
        >
          <span data-count="24">24</span>/7
        </p>
      </div>
      <PersonaCarousel />
    </section>
  );
}
