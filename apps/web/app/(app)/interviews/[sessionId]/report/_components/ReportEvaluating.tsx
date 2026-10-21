import { Card, StatusDot } from "@/components/ds";
import { BarsMascot } from "@/components/mascot/BarsMascot";

export const EVALUATING_STEPS = [
  "Reading your answers",
  "Grading",
  "Checking with a second grader",
  "Writing your report",
] as const;

/** Shown while the round is being graded. The page polls every 5 s, so this is really running. */
export function ReportEvaluating() {
  return (
    <Card
      title="Grading your round"
      action={<StatusDot state="live" label="Working" />}
      className="max-w-[560px]"
    >
      <div className="flex justify-center pb-4 pt-4">
        <BarsMascot mood="thinking" size={96} />
      </div>
      <p className="m-0 text-[14px] leading-[1.55] text-ink-3">
        This usually takes a minute or two. You can leave this page; your report will be here when it is done.
      </p>
      <ol className="m-0 mt-5 grid list-none gap-3 p-0">
        {EVALUATING_STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-3 text-[14px]">
            <StatusDot state="live" label="In progress" srOnly />
            <span className="font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
