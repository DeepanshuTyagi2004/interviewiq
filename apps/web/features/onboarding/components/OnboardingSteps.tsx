import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * The design's horizontal step bar: numbered circles joined by hairlines — the current step in
 * the brand accent, finished steps in ink with a tick. Labels of other steps hide on phones.
 */
export function OnboardingSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Onboarding progress" className="border-b border-line px-5 py-5 sm:px-8 sm:py-[22px]">
      <ol className="m-0 flex list-none items-center gap-2 p-0">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          const last = i === steps.length - 1;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={cn("flex min-w-0 items-center gap-2.5", last ? "flex-none" : "flex-1")}
            >
              <span
                className={cn(
                  "flex h-6 w-6 flex-none items-center justify-center rounded-full border font-mono text-[11px] transition-colors duration-300",
                  active && "border-brand bg-brand text-brand-foreground",
                  done && "border-primary bg-primary text-primary-foreground",
                  !active && !done && "border-line-4 text-faint",
                )}
              >
                {done ? <Check aria-hidden className="h-3 w-3" /> : i + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-[13.5px]",
                  active || done ? "text-foreground" : "text-faint",
                  !active && "hidden sm:inline",
                )}
              >
                {label}
                {done ? <span className="sr-only"> (done)</span> : null}
              </span>
              {!last ? (
                <span aria-hidden className={cn("h-px min-w-3 flex-1", done ? "bg-foreground" : "bg-line-2")} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
