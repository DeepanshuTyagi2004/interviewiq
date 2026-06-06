"use client";

import { Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { LeetCodeFragment } from "@/features/profile";

const config: ChartConfig = {
  easy: { label: "Easy", color: "hsl(142 71% 45%)" },
  medium: { label: "Medium", color: "hsl(38 92% 50%)" },
  hard: { label: "Hard", color: "hsl(0 72% 51%)" },
};

export function LeetCodeDifficulty({ solved }: { solved?: LeetCodeFragment["solved"] }) {
  const total = solved ? solved.easy + solved.medium + solved.hard : 0;
  if (!solved || total === 0) {
    return <p className="text-sm text-muted-foreground">No LeetCode data yet.</p>;
  }

  const data = [
    { key: "easy", label: "Easy", value: solved.easy, fill: "hsl(142 71% 45%)" },
    { key: "medium", label: "Medium", value: solved.medium, fill: "hsl(38 92% 50%)" },
    { key: "hard", label: "Hard", value: solved.hard, fill: "hsl(0 72% 51%)" },
  ];

  return (
    <ChartContainer config={config} className="mx-auto aspect-square max-h-[260px]">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={48} strokeWidth={2} />
        <ChartLegend content={<ChartLegendContent nameKey="label" />} />
      </PieChart>
    </ChartContainer>
  );
}
