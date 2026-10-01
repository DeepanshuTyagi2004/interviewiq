import { cn } from "@/lib/utils/cn";
import { ROUTES } from "@/lib/constants/shared";
import { Accordion } from "./Accordion";
import { UNIVERSITY_POINTS } from "./content";
import { CONTAINER, Eyebrow, OutlineLink } from "./primitives";

const ITEMS = UNIVERSITY_POINTS.map(([title, body]) => ({ title, body }));

/** "Don't change your placement process." — pitch to placement cells with an accordion of points. */
export function Universities() {
  return (
    <section
      id="universities"
      className={cn(CONTAINER, "flex scroll-mt-16 flex-col gap-10 pt-24 sm:pt-[140px] lg:flex-row lg:gap-14")}
    >
      <div className="flex min-w-0 flex-col gap-5 lg:flex-[1_1_380px]">
        <Eyebrow>INTERVIEWIQ FOR UNIVERSITIES</Eyebrow>
        <h2
          data-reveal
          className="m-0 max-w-[520px] text-[clamp(34px,4vw,56px)] font-normal leading-[1.02] tracking-[-0.045em]"
        >
          Don&apos;t change your placement process. Just add InterviewIQ.
        </h2>
        <p className="m-0 max-w-[420px] text-[15px] leading-[1.55] text-muted-foreground">
          Realistic practice for every student, for the companies coming to your campus — running alongside what you
          already do.
        </p>
        <OutlineLink href={ROUTES.contact} className="mt-4 h-10 px-[18px]">
          Book a university pilot
        </OutlineLink>
      </div>
      <div className="min-w-0 lg:flex-[1_1_440px]">
        <Accordion items={ITEMS} variant="sign" />
      </div>
    </section>
  );
}
