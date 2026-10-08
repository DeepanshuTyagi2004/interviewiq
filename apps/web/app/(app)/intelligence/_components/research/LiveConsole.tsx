"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { padCount } from "@/components/hud";
import { ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Input } from "@/components/ui/input";
import { NODE_ORDER } from "@/lib/constants/research";
import { cn } from "@/lib/utils/cn";
import {
  DEFAULT_FILTERS, LEVEL_ORDER, copyText, filterEvents, logLine,
   type EventFilters, type ResearchEvent, type ResearchItem,
} from "@/features/research";

const SELECT = "h-8 w-auto rounded-full border border-input bg-card px-3 font-mono text-[12px]";

/** Bottom pane: every trace event, live. Filters, follow-tail, older pages, copy. */
export function LiveConsole({
  events,
  items,
  live,
  onSelectSpan,
  canLoadOlder,
  onLoadOlder,
  loadingOlder,
}: {
  events: ResearchEvent[];
  items: ResearchItem[];
  live: boolean;
  onSelectSpan: (spanId: string, companyId: string | null) => void;
  canLoadOlder: boolean;
  onLoadOlder: () => void;
  loadingOlder: boolean;
}) {
  const [filters, setFilters] = React.useState<EventFilters>(DEFAULT_FILTERS);
  const [follow, setFollow] = React.useState(true);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const shown = React.useMemo(() => filterEvents(events, filters), [events, filters]);
  const companies = React.useMemo(() => new Map(items.map((i) => [i.company_id, i.company_name])), [items]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!atBottom && follow) setFollow(false);
  };
  const set = <K extends keyof EventFilters>(key: K, value: EventFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <ConsoleCard title="Console" meta={<HeaderCount>{padCount(shown.length)} / {padCount(events.length)}{live ? " · live" : ""}</HeaderCount>}>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <CustomSelect label="Minimum level" className={SELECT} value={filters.minLevel} options={LEVEL_ORDER.map((level) => ({ value: level, label: `${level}+` }))} onValueChange={(value) => { const level = LEVEL_ORDER.find((item) => item === value); if (level) set("minLevel", level); }} />
        <CustomSelect label="Company" className={SELECT} value={filters.companyId ?? ""} options={[{ value: "", label: "All companies" }, ...[...companies].map(([id, name]) => ({ value: id, label: name }))]} onValueChange={(value) => set("companyId", value || null)} />
        <CustomSelect label="Node" className={SELECT} value={filters.node ?? ""} options={[{ value: "", label: "All nodes" }, ...NODE_ORDER.map((node) => ({ value: node, label: node }))]} onValueChange={(value) => set("node", value || null)} />
        <Input aria-label="Event type prefix" placeholder="type, e.g. span." value={filters.type} onChange={(e) => set("type", e.target.value)} className="h-8 w-36 rounded-full font-mono text-[12px]" />
        <Input aria-label="Search messages" placeholder="search…" value={filters.q} onChange={(e) => set("q", e.target.value)} className="h-8 w-44 rounded-full text-[12px]" />
        <Button size="sm" variant={follow ? "ink" : "strong"} aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
          {follow ? "Following" : "Follow tail"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!canLoadOlder || loadingOlder} onClick={onLoadOlder}>
          {loadingOlder ? "Loading…" : "Load older"}
        </Button>
        <Button size="sm" variant="ghost" disabled={shown.length === 0} onClick={() => copyText(shown.map(logLine).join("\n"), "Visible lines copied")}>
          Copy visible
        </Button>
      </div>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        role="log"
        aria-label="Research events"
        className="h-[420px] overflow-y-auto rounded-md border border-line-2 bg-panel p-2 font-mono text-[11.5px] leading-[1.55]"
      >
        {shown.length === 0 ? (
          <p className="m-0 p-2 text-faint">{events.length > 0 ? "No events match these filters." : "Waiting for events…"}</p>
        ) : (
          shown.map((e) => (
            <div
              key={e.seq}
              className={cn(
                "group flex gap-2 rounded px-1 hover:bg-accent",
                e.level === "error" && "text-destructive",
                e.level === "warn" && "text-[hsl(var(--color-lc-medium))]",
              )}
            >
              <span className="w-12 flex-none text-right tabular-nums text-faint">{e.seq}</span>
              <span className="w-16 flex-none tabular-nums text-faint">{e.ts.slice(11, 19)}</span>
              <span className="w-10 flex-none uppercase">{e.level}</span>
              <span className="w-24 flex-none truncate text-faint">{e.company_id ? (companies.get(e.company_id) ?? e.company_id.slice(0, 8)) : "—"}</span>
              <span className="w-20 flex-none truncate text-faint">{e.node ?? "—"}</span>
              <span className="w-28 flex-none truncate">{e.type}</span>
              {e.span_id ? (
                <button type="button" title={e.message} className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onSelectSpan(e.span_id!, e.company_id ?? null)}>
                  {e.message}
                </button>
              ) : (
                <span title={e.message} className="min-w-0 flex-1 truncate">{e.message}</span>
              )}
              <button
                type="button"
                aria-label={`Copy event ${e.seq}`}
                className="flex-none text-faint opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => copyText(JSON.stringify(e, null, 2), "Event copied")}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </ConsoleCard>
  );
}
