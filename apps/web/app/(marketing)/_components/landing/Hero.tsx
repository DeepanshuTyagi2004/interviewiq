import { cn } from "@/lib/utils/cn";
import { COMPANIES } from "./content";
import { HeroScene } from "./HeroScene";
import { CONTAINER } from "./primitives";
import { HeroSignup } from "./SignupForms";
import { SourceStack } from "./SourceStack";

/** [hue token, left, top, width, height, animation delay in s] for each aurora pool. */
const AURORA: [string, string, string, string, string, number][] = [
  ["--aurora-1", "8%", "-6%", "46%", "62%", 0],
  ["--aurora-2", "46%", "-14%", "42%", "58%", 7],
  ["--aurora-3", "70%", "6%", "36%", "50%", 13],
];

/** Headline and sign-up on the left, the glass interview scene on the right, then the sources stage. */
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
        <div className="grid items-center gap-12 pb-14 pt-14 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-20">
          <div className="flex min-w-0 flex-col items-start text-left">
            <h1 className="iq-intro m-0 text-balance text-[clamp(36px,4.7vw,64px)] font-bold leading-[1.06] tracking-[-0.035em] [--i:1]">
              Rehearse the interview you&apos;re{" "}
              <span className="iq-wordmark-iq">actually walking into</span>
            </h1>
            <p className="iq-intro m-0 mt-6 max-w-[540px] text-pretty text-[19px] leading-[1.45] text-ink-2 [--i:2] sm:text-[21px]">
              Spend less time guessing, more time practising — with an AI interviewer that knows your resume and
              your target company&apos;s real process.
            </p>
            <p className="iq-intro m-0 mt-4 text-[13px] text-ink-3 [--i:3]">Free to start, no card required</p>
            <div className="iq-intro mt-6 flex w-full [--i:4]">
              <HeroSignup />
            </div>
          </div>
          <div className="iq-intro min-w-0 [--i:3]">
            <HeroScene />
          </div>
        </div>

        <div className="iq-intro iq-stage relative flex h-[420px] items-center justify-center [--i:5] sm:h-[580px]">
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
              "font-display text-lg font-semibold tracking-[-0.03em] sm:text-[24px]",
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
