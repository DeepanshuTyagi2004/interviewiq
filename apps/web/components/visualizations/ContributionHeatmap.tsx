import { cn } from "@/lib/utils/cn";

/** 52 weeks x 7 days of contribution counts (spec §4). */
export interface ContributionHeatmapProps {
  weeks: number[][];
  totalLastYear: number;
}

/** Map a count to one of 5 intensity bins (0 = none). Descriptive only. */
function bin(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

const BIN_CLASS = [
  "bg-muted",
  "bg-emerald-900",
  "bg-emerald-700",
  "bg-emerald-500",
  "bg-emerald-300",
];

export function ContributionHeatmap({ weeks, totalLastYear }: ContributionHeatmapProps) {
  const max = weeks.reduce(
    (acc, w) => Math.max(acc, ...(w.length ? w : [0])),
    0,
  );

  if (!weeks.length) {
    return (
      <p className="text-sm text-muted-foreground">No contribution data yet.</p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {totalLastYear.toLocaleString()} contributions in the last year
      </p>
      <div
        className="flex gap-[3px] overflow-x-auto"
        role="img"
        aria-label={`GitHub contribution heatmap, ${totalLastYear} contributions in the last year`}
      >
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((count, di) => (
              <span
                key={di}
                title={`${count} contributions`}
                className={cn(
                  "h-[11px] w-[11px] rounded-[2px]",
                  BIN_CLASS[bin(count, max)],
                )}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>Less</span>
        {BIN_CLASS.map((c, i) => (
          <span key={i} className={cn("h-[11px] w-[11px] rounded-[2px]", c)} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
