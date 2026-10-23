import { cn } from "@/lib/utils/cn";
import { COMPANIES } from "./content";
import { CONTAINER } from "./primitives";
import { HeroSignup } from "./SignupForms";
import { SourceStack } from "./SourceStack";

/** [hue token, left, top, width, height, animation delay in s] for each aurora pool. */
const AURORA: [string, string, string, string, string, number][] = [
  ["--aurora-1", "8%", "-6%", "46%", "62%", 0],
  ["--aurora-2", "46%", "-14%", "42%", "58%", 7],
  ["--aurora-3", "70%", "6%", "36%", "50%", 13],
];

/** Headline, sign-up block and the rotating "connected sources" panel, rising in on load. */
export function Hero() {
  return (
    <section id="top" className="relative scroll-mt-20">
      {/* Content layer: soft hue pools that run up behind the glass header. */}
      <div aria-hidden className="iq-aurora !-top-14">
        {AURORA.map(([token, left, top, width, height, delay]) => (
          <span
            key={token}
            style={{ left, top, width, height, background: `hsl(var(${token}))`, animationDelay: `-${delay}s` }}
          />
        ))}
      </div>

      <div className={cn(CONTAINER, "relative z-10")}>
        <div className="mx-auto flex max-w-[900px] flex-col items-center pb-12 pt-16 text-center sm:pb-16 sm:pt-[104px]">
          <h1 className="iq-intro m-0 bg-gradient-to-b from-ink to-ink-2 bg-clip-text text-balance pb-1 text-[clamp(40px,6.6vw,88px)] font-semibold leading-[1.03] tracking-[-0.045em] text-transparent [--i:0]">
            Rehearse the interview you&apos;re actually walking into
          </h1>
          <p className="iq-intro m-0 mt-6 max-w-[620px] text-pretty text-[19px] leading-[1.4] text-ink-2 [--i:1] sm:text-[22px]">
            Spend less time guessing, more time practising — with an AI interviewer that knows your resume and
            your target company&apos;s real process.
          </p>
          <p className="iq-intro m-0 mt-4 text-[13px] text-ink-3 [--i:2]">Free to start, no card required</p>
          <div className="iq-intro mt-7 flex w-full justify-center [--i:3]">
            <HeroSignup />
          </div>
        </div>

        <div className="iq-intro iq-stage relative flex h-[420px] items-center justify-center [--i:4] sm:h-[580px]">
          <p className="iq-eyebrow absolute left-6 top-6 m-0 sm:left-9 sm:top-8">Connected sources</p>
          <SourceStack />
        </div>
      </div>
    </section>
  );
}

/** "Researched for" company wordmarks — the launch company in ink, the rest faded. */
export function CompanyLogos() {
  return (
    <section id="companies" className={cn(CONTAINER, "scroll-mt-16 pb-6 pt-20")}>
      <p className="iq-eyebrow m-0 text-center">Real interview processes, researched for</p>
      <ul className="m-0 mt-8 flex list-none flex-wrap items-center justify-center gap-x-8 gap-y-5 p-0 sm:gap-x-14">
        {COMPANIES.map((name, i) => (
          <li
            key={name}
            className={cn(
              "text-lg font-semibold tracking-[-0.04em] sm:text-[24px]",
              i === 0 ? "text-foreground" : "text-ink-3/70",
            )}
          >
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
