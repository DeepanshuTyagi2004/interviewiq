"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { LeetCodeFragment } from "@/features/profile";

const config: ChartConfig = {
  count: { label: "Solved", color: "hsl(var(--chart-1))" },
};

export function LeetCodeTopics({ byTopic }: { byTopic?: LeetCodeFragment["byTopic"] }) {
  if (!byTopic || byTopic.length === 0) {
    return <p className="text-sm text-muted-foreground">No LeetCode topic data yet.</p>;
  }

  return (
    <ChartContainer config={config} className="max-h-[280px] w-full">
      <BarChart accessibilityLayer data={byTopic} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="topic"
          tickLine={false}
          axisLine={false}
          width={96}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
