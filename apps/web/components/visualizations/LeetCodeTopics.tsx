"use client";

import { useId, useState } from "react";
import type { LeetCodeFragment } from "@/features/profile";

/** Topics shown before "Show all". */
const INITIAL = 8;

/**
 * Solved problems per topic as a ranked bar list: one ink series (so no legend), the count at
 * each bar's tip, bars scaled to the largest topic. Counts only — never a comparison to others.
 */
export function LeetCodeTopics({ byTopic }: { byTopic?: LeetCodeFragment["byTopic"] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const topics = (byTopic ?? []).filter((t) => t.count > 0).sort((a, b) => b.count - a.count);
  if (topics.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">No LeetCode topic data yet.</p>;
  }

  const max = topics[0].count;
  const visible = expanded ? topics : topics.slice(0, INITIAL);
  const hidden = topics.length - INITIAL;

  return (
    <div className="flex flex-col gap-3">
      <ul id={listId} aria-label="Problems solved by topic" className="m-0 flex list-none flex-col gap-2 p-0">
        {visible.map((t) => (
          <li
            key={t.topic}
            title={`${t.topic} · ${t.count.toLocaleString()} solved`}
            className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"
          >
            <span className="truncate text-muted-foreground">{t.topic}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="h-1.5 min-w-[3px] rounded-r-[3px] bg-foreground"
                // Leave room for the count at the tip of the longest bar.
                style={{ width: `calc((100% - 3.5rem) * ${Math.max(0.02, t.count / max).toFixed(4)})` }}
              />
              <span className="flex-none font-mono text-xs tabular-nums">
                {t.count.toLocaleString()}
                <span className="sr-only"> solved</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-controls={listId}
          className="self-start text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {expanded ? "Show fewer topics" : `Show all ${topics.length} topics`}
        </button>
      ) : null}
    </div>
  );
}
