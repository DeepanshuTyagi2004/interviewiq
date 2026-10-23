import { cn } from "@/lib/utils/cn";
import { CONTAINER } from "./primitives";
import { CtaSignup } from "./SignupForms";

/** [colour token, left, top, size, animation offset in s] for each drifting blob. */
const BLOBS: [string, string, string, string, number][] = [
  ["--aurora-1", "58%", "-12%", "58%", 0],
  ["--aurora-2", "75%", "40%", "50%", 4],
  ["--aurora-3", "40%", "55%", "45%", 8],
  ["--aurora-1", "90%", "-5%", "35%", 2],
];

/** Closing call to action over slowly drifting, heavily blurred blobs. */
export function ClosingCta() {
  return (
    <section id="start" className={cn(CONTAINER, "mt-24 scroll-mt-16 sm:mt-[120px]")}>
      <div className="iq-stage relative flex min-h-[440px] items-center sm:min-h-[520px]">
        <div aria-hidden className="absolute inset-0 blur-[60px]">
          {BLOBS.map(([token, left, top, size, delay], i) => (
            <span
              key={`${token}-${left}`}
              data-motion
              className="absolute rounded-full opacity-60"
              style={{
                left,
                top,
                width: size,
                paddingBottom: size,
                background: `hsl(var(${token}))`,
                animation: `iq-drift ${18 + i * 3}s ease-in-out -${delay}s infinite`,
              }}
            />
          ))}
        </div>
        <div className="relative flex max-w-[560px] flex-col gap-[18px] px-5 py-12 sm:px-12 sm:py-16">
          <h2
            data-reveal
            className="iq-h2 text-[clamp(34px,4.4vw,60px)] leading-[1.04]"
          >
            It&apos;s time to rehearse the real interview, not random questions
          </h2>
          <p className="m-0 max-w-[400px] text-[17px] leading-[1.5] text-muted-foreground">
            Everything you need to walk in prepared — the company&apos;s process, a real interviewer, and a debrief after
            every round.
          </p>
          <CtaSignup />
        </div>
      </div>
    </section>
  );
}
