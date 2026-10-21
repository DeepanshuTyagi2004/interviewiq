import { Card, Stat } from "@/components/ds";
import { formatScore, type RoundReport } from "@/features/report";

/** Summary, strengths and the Practical / Theory sub-scores. */
export function OverviewCard({ report }: { report: RoundReport }) {
  const strengths = report.strengths ?? [];
  const hasSub = report.practicalScore != null || report.theoryScore != null;
  return (
    <Card title="Overview" bodyClassName="flex flex-col gap-6">
      {report.summary ? <p className="m-0 max-w-[68ch] text-[15px] leading-[1.65] text-ink">{report.summary}</p> : null}
      {strengths.length > 0 ? (
        <div>
          <h3 className="m-0 text-[13px] font-normal text-ink-3">Strengths</h3>
          <ul className="m-0 mt-2.5 grid list-none gap-2 p-0 text-[14px] leading-[1.55]">
            {strengths.map((s) => (
              <li key={s} className="flex gap-3">
                <span aria-hidden className="mt-[9px] h-1 w-1 flex-none rounded-full bg-ink" />
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasSub ? (
        <div className="flex flex-wrap gap-x-12 gap-y-4 border-t border-line pt-5">
          {report.practicalScore != null ? <Stat size="sm" label="Practical" value={formatScore(report.practicalScore)} unit="/ 10" /> : null}
          {report.theoryScore != null ? <Stat size="sm" label="Theory" value={formatScore(report.theoryScore)} unit="/ 10" /> : null}
        </div>
      ) : null}
    </Card>
  );
}
