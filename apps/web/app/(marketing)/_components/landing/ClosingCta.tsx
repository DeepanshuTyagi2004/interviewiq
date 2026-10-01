import { cn } from "@/lib/utils/cn";
import { CONTAINER } from "./primitives";
import { CtaSignup } from "./SignupForms";

/** [colour token, left, top, size, animation offset in s] for each drifting blob. */
const BLOBS: [string, string, string, string, number][] = [
  ["--brand", "58%", "-12%", "58%", 0],
  ["--blob-2", "75%", "40%", "50%", 4],
  ["--line", "40%", "55%", "45%", 8],
  ["--blob-4", "90%", "-5%", "35%", 2],
];

/** Closing call to action over slowly drifting, heavily blurred blobs. */
export function ClosingCta() {
  return (
    <section id="start" className={cn(CONTAINER, "mt-24 scroll-mt-16 sm:mt-[120px]")}>
      <div className="relative flex min-h-[420px] items-center overflow-hidden bg-frame sm:min-h-[480px]">
        <div aria-hidden className="absolute inset-0 blur-[60px]">
          {BLOBS.map(([token, left, top, size, delay], i) => (
            <span
              key={token}
              data-motion
              className="absolute rounded-full opacity-90"
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
            className="m-0 text-[clamp(34px,4.2vw,58px)] font-normal leading-[1.02] tracking-[-0.045em]"
          >
            It&apos;s time to rehearse the real interview, not random questions
          </h2>
          <p className="m-0 max-w-[400px] text-[14.5px] leading-[1.55] text-muted-foreground">
            Everything you need to walk in prepared — the company&apos;s process, a real interviewer, and a debrief after
            every round.
          </p>
          <CtaSignup />
        </div>
      </div>
    </section>
  );
}
