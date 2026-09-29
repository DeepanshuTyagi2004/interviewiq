"use client";

import { Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { LeetCodeFragment } from "@/features/profile";

// Colors reference CSS variable tokens defined in globals.css so they respond
// correctly to dark-mode theming (--color-lc-easy/medium/hard are defined in
// both :root and .dark).
const config: ChartConfig = {
  easy: { label: "Easy", color: "hsl(var(--color-lc-easy))" },
  medium: { label: "Medium", color: "hsl(var(--color-lc-medium))" },
  hard: { label: "Hard", color: "hsl(var(--color-lc-hard))" },
};

export function LeetCodeDifficulty({ solved }: { solved?: LeetCodeFragment["solved"] }) {
  const total = solved ? solved.easy + solved.medium + solved.hard : 0;
  if (!solved || total === 0) {
    return <p className="text-sm text-muted-foreground">No LeetCode data yet.</p>;
  }

  const data = [
    { key: "easy", label: "Easy", value: solved.easy, fill: "hsl(var(--color-lc-easy))" },
    { key: "medium", label: "Medium", value: solved.medium, fill: "hsl(var(--color-lc-medium))" },
    { key: "hard", label: "Hard", value: solved.hard, fill: "hsl(var(--color-lc-hard))" },
  ];

  return (
    <div className="space-y-3">
      <ChartContainer config={config} className="mx-auto aspect-square max-h-[260px]">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
          <Pie data={data} dataKey="value" nameKey="label" innerRadius={48} strokeWidth={2} />
        </PieChart>
      </ChartContainer>
      {/* Own-markup legend OUTSIDE Recharts: deterministic DOM text in jsdom.
          ChartLegend/ChartLegendContent render inside the SVG tree and produce
          0x0 in jsdom — this plain <ul> is the reliable assertion target for tests. */}
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        {data.map((d) => (
          <li key={d.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: d.fill }}
            />
            <span>
              {d.label}
              <span className="ml-1 tabular-nums text-muted-foreground">{d.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
