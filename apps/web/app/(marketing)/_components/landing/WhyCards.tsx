import { cn } from "@/lib/utils/cn";
import { FEATURES } from "./content";
import { CONTAINER, Eyebrow } from "./primitives";

/** "Practice that actually prepares you" — four value cards on a panel. */
export function WhyCards() {
  return (
    <section className={cn(CONTAINER, "mt-24 sm:mt-[120px]")}>
      <div className="bg-panel px-4 py-14 sm:px-8 sm:py-20">
        <div className="flex flex-col items-center text-center">
          <Eyebrow>WHY INTERVIEWIQ</Eyebrow>
          <h2
            data-reveal
            className="m-0 mt-3.5 text-balance text-[clamp(32px,3.8vw,52px)] font-normal leading-[1.06] tracking-[-0.045em]"
          >
            Practice that actually prepares you
          </h2>
          <p className="m-0 mt-3.5 text-[15px] text-muted-foreground">
            Generic practice asks questions. InterviewIQ runs the real interview.
          </p>
        </div>
        <ul className="m-0 mx-auto mt-12 grid max-w-[1100px] list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              data-reveal
              className="flex min-h-[220px] flex-col gap-2.5 rounded-lg bg-card px-[22px] pb-7 pt-6 transition-shadow duration-300 hover:shadow-lift"
            >
              <span
                aria-hidden
                className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-foreground text-xs"
              >
                {f.icon}
              </span>
              <h3 className="m-0 mt-3.5 text-[17px] font-normal leading-[1.25] tracking-[-0.02em]">{f.title}</h3>
              <p className="m-0 text-[13px] leading-[1.5] text-muted-foreground">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
