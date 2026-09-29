"use client";

import { Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { GithubLanguage } from "@/features/profile";

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function LanguageDistribution({ languages }: { languages: GithubLanguage[] }) {
  if (!languages.length) {
    return <p className="text-sm text-muted-foreground">No language data yet.</p>;
  }

  const data = languages.map((l, i) => ({
    name: l.name,
    pct: l.pct,
    fill: COLORS[i % COLORS.length],
  }));

  const config: ChartConfig = Object.fromEntries(
    languages.map((l, i) => [
      l.name,
      { label: l.name, color: `hsl(var(--chart-${(i % 5) + 1}))` },
    ]),
  );

  return (
    <div className="space-y-3">
      <ChartContainer config={config} className="mx-auto aspect-square max-h-[260px]">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
          <Pie data={data} dataKey="pct" nameKey="name" innerRadius={48} strokeWidth={2} />
        </PieChart>
      </ChartContainer>
      {/* Own-markup legend OUTSIDE Recharts: deterministic DOM text in jsdom. */}
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: d.fill }}
            />
            <span>{d.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
