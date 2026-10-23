import { cn } from "@/lib/utils/cn";
import { FEATURES } from "./content";
import { CONTAINER } from "./primitives";

/** "Practice that actually prepares you": the heading beside a ruled list, one claim per row. */
export function WhyCards() {
  return (
    <section className={cn(CONTAINER, "mt-24 sm:mt-[120px]")}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 data-reveal className="iq-h2 max-w-[460px] text-balance text-[clamp(32px,4vw,52px)]">
            Practice that actually prepares you
          </h2>
          <p className="m-0 mt-5 max-w-[400px] text-[17px] leading-[1.5] text-muted-foreground">
            Generic practice asks questions. InterviewIQ runs the real interview.
          </p>
        </div>
        <ul className="m-0 list-none p-0">
          {FEATURES.map((f) => (
            <li key={f.title} data-reveal className="border-t border-line-2 py-7 first:border-t-0 first:pt-0 lg:first:pt-1">
              <h3 className="m-0 text-[22px] font-semibold leading-[1.2] tracking-[-0.02em]">{f.title}</h3>
              <p className="m-0 mt-2 max-w-[520px] text-[16px] leading-[1.55] text-muted-foreground">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
