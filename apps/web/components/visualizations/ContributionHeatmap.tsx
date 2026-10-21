/** 52 weeks x 7 days of contribution counts (spec §4). */
export interface ContributionHeatmapProps {
  weeks: number[][];
  totalLastYear: number;
}

/** Map a count to one of 5 intensity bins (0 = none). Descriptive only. */
export function heatBin(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/**
 * Grey intensity ramp (line → ink). Bins 0–4 use the `--heat-0..4` tokens defined in globals.css (light + dark), so no raw hex lives here.
 */
const BIN_COLOR = [
  "hsl(var(--heat-0))",
  "hsl(var(--heat-1))",
  "hsl(var(--heat-2))",
  "hsl(var(--heat-3))",
  "hsl(var(--heat-4))",
];

/**
 * A year of contributions. Cells are fluid (the grid fills its container); below ~460px the grid
 * keeps a readable cell size and scrolls sideways inside its own focusable container.
 */
export function ContributionHeatmap({ weeks, totalLastYear }: ContributionHeatmapProps) {
  if (!weeks.length) {
    return <p className="m-0 text-sm text-muted-foreground">No contribution data yet.</p>;
  }

  const max = weeks.reduce((acc, w) => Math.max(acc, ...(w.length ? w : [0])), 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13px] text-muted-foreground">
        <span className="font-mono tabular-nums text-foreground">{totalLastYear.toLocaleString()}</span>{" "}
        contributions in the last year
      </p>
      <div
        tabIndex={0}
        aria-label="Contribution heatmap (scrolls sideways on small screens)"
        // rtl on the scroller + ltr inside: when it has to scroll, it opens on the most recent weeks.
        className="overflow-x-auto rounded-sm pb-1 [direction:rtl] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div
          role="img"
          aria-label={`GitHub contribution heatmap, ${totalLastYear} contributions in the last year`}
          className="grid min-w-[460px] gap-[2px] [direction:ltr] sm:gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
        >
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-rows-7 gap-[2px] sm:gap-[3px]">
              {week.map((count, di) => (
                <span
                  key={di}
                  title={`${count} ${count === 1 ? "contribution" : "contributions"}`}
                  className="aspect-square w-full rounded-[2px]"
                  style={{ backgroundColor: BIN_COLOR[heatBin(count, max)] }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 text-xs text-faint">
        <span className="mr-1">Less</span>
        {BIN_COLOR.map((c, i) => (
          <span key={i} aria-hidden className="h-[10px] w-[10px] rounded-[2px]" style={{ backgroundColor: c }} />
        ))}
        <span className="ml-1">More</span>
      </div>
    </div>
  );
}
