import { cn } from "@/lib/utils/cn";
import { COMPANIES } from "./content";
import { CONTAINER } from "./primitives";
import { HeroSignup } from "./SignupForms";
import { SourceStack } from "./SourceStack";

/** Headline, sign-up block and the rotating "connected sources" panel, blurring in on load. */
export function Hero() {
  return (
    <section id="top" className={cn(CONTAINER, "scroll-mt-20")}>
      <div className="mx-auto flex max-w-[860px] flex-col items-center pb-10 pt-14 text-center sm:pb-14 sm:pt-[88px]">
        <h1 className="iq-intro m-0 text-balance text-[clamp(38px,5.8vw,76px)] font-normal leading-[1.02] tracking-[-0.045em] [--i:0]">
          Rehearse the interview you&apos;re actually walking into
        </h1>
        <p className="iq-intro m-0 mt-[22px] max-w-[560px] text-pretty text-base leading-[1.55] text-muted-foreground [--i:1] sm:text-[17px]">
          Spend less time guessing, more time practising — with an AI interviewer that knows your
          résumé and your target company&apos;s real process.
        </p>
        <p className="iq-intro m-0 mt-3.5 flex items-center gap-1.5 text-xs text-faint [--i:2]">
          <span
            aria-hidden
            className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-faint text-[7px]"
          >
            ✓
          </span>
          Free to start, no card required
        </p>
        <div className="iq-intro mt-8 flex w-full justify-center [--i:3]">
          <HeroSignup />
        </div>
      </div>

      <div className="iq-intro relative flex h-[400px] items-center justify-center overflow-hidden bg-panel [--i:4] sm:h-[520px]">
        <p className="iq-eyebrow absolute left-5 top-5 m-0 sm:left-7 sm:top-6">Connected sources</p>
        <SourceStack />
      </div>
    </section>
  );
}

/** "Researched for" company wordmarks — the launch company in ink, the rest faded. */
export function CompanyLogos() {
  return (
    <section id="companies" className={cn(CONTAINER, "scroll-mt-16 pb-6 pt-16")}>
      <p className="iq-eyebrow m-0 text-center">Real interview processes, researched for</p>
      <ul className="m-0 mt-7 flex list-none flex-wrap items-center justify-center gap-x-8 gap-y-5 p-0 sm:gap-x-14">
        {COMPANIES.map((name, i) => (
          <li
            key={name}
            className={cn(
              "text-lg font-semibold tracking-[-0.045em] sm:text-[22px]",
              i === 0 ? "text-foreground" : "text-faint-2",
            )}
          >
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
