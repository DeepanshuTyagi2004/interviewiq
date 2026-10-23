"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Info, Plus, Search, X } from "lucide-react";
import { CustomSelect } from "@/components/ui/custom-select";
import { MAX_INFO_NODES, MAX_ROUND_NODES } from "@/features/loops/graph";
import { NODE_CATEGORIES, NODE_PRESETS, filterNodePresets } from "@/features/loops/presets";
import { PALETTE_MIME } from "@/features/loops/components/FlowCanvas";
import { ROUND_MINUTES_LABEL } from "@/lib/constants/interview";
import { cn } from "@/lib/utils/cn";
import { createNodeDragPreview } from "./nodeDragPreview";

export function NodePalette({ onAdd, disabled, roundCount, infoCount }: {
  onAdd: (id: string) => void; disabled: boolean; roundCount: number; infoCount: number;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const uid = useId();
  const dragPreview = useRef<HTMLElement | null>(null);
  const suppressDragClick = useRef(false);
  const clearDragPreview = useCallback(() => {
    dragPreview.current?.remove();
    dragPreview.current = null;
  }, []);
  useEffect(() => {
    function cancel(event: KeyboardEvent) { if (event.key === "Escape") clearDragPreview(); }
    document.addEventListener("drop", clearDragPreview, true);
    document.addEventListener("dragend", clearDragPreview, true);
    document.addEventListener("keydown", cancel);
    window.addEventListener("blur", clearDragPreview);
    return () => {
      clearDragPreview();
      document.removeEventListener("drop", clearDragPreview, true);
      document.removeEventListener("dragend", clearDragPreview, true);
      document.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", clearDragPreview);
    };
  }, [clearDragPreview]);
  useEffect(() => { if (disabled) clearDragPreview(); }, [disabled, clearDragPreview]);
  const results = useMemo(() => filterNodePresets(query, category), [query, category]);
  const groups = NODE_CATEGORIES.map((group) => ({ ...group, nodes: results.filter((node) => node.category === group.id) })).filter((group) => group.nodes.length);
  function reset() { setQuery(""); setCategory("all"); }

  return <aside aria-label="Node palette" inert={disabled} className="flex min-h-0 max-h-[440px] flex-col overflow-hidden rounded-card border border-line bg-background shadow-float md:absolute md:bottom-6 md:left-6 md:top-6 md:z-10 md:max-h-none md:w-[280px]">
    <div className="shrink-0 space-y-3 border-b border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 font-display text-[16px] font-medium tracking-[-0.01em]">Node library</h2>
        <span className="font-mono text-xs text-ink-3">{NODE_PRESETS.length} nodes</span>
      </div>
      <p className="m-0 text-[12.5px] leading-relaxed text-ink-2">Click to chain a round. Drag to place it. Reference steps never run.</p>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3.5 top-3.5 h-3.5 w-3.5 text-ink-3" />
        <input aria-label="Search nodes" disabled={disabled} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills, tools, topics…" className="h-10 w-full rounded-full bg-background pl-9 pr-9 text-[12.5px] shadow-ring outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50" />
        {query ? <button type="button" aria-label="Clear search" disabled={disabled} onClick={() => setQuery("")} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"><X aria-hidden className="h-3.5 w-3.5" /></button> : null}
      </div>
      <CustomSelect label="Node category" value={category} onValueChange={setCategory} disabled={disabled} options={[{ value: "all", label: "All categories" }, ...NODE_CATEGORIES.map((group) => ({ value: group.id, label: group.label }))]} className="h-9 text-[12.5px]" />
      <div className="flex items-center justify-between gap-2 text-xs text-ink-3">
        <span role="status" aria-live="polite" aria-atomic="true">{results.length} {results.length === 1 ? "node" : "nodes"} found</span>
        {query || category !== "all" ? <button type="button" disabled={disabled} onClick={reset} className="rounded text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">Reset filters</button> : null}
      </div>
    </div>
    <div aria-label="Node results" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-3">
      {groups.map((group) => <section key={group.id} aria-labelledby={`${uid}-${group.id}`}>
        <h3 id={`${uid}-${group.id}`} title={group.description} className="iq-eyebrow mb-2 mt-0 flex items-center justify-between px-1 text-ink-3"><span>{group.label}</span><span className="font-mono">{group.nodes.length}</span></h3>
        <div className="space-y-2">
          {group.nodes.map((node) => {
            const capped = node.kind === "round" ? roundCount >= MAX_ROUND_NODES : infoCount >= MAX_INFO_NODES;
            const hint = [node.description, `Topics: ${node.topics.join(", ")}`, node.keywords.length ? `Keywords: ${node.keywords.join(", ")}` : "", capped ? `Limit reached: ${node.kind === "round" ? MAX_ROUND_NODES + " rounds" : MAX_INFO_NODES + " reference steps"}.` : ""].filter(Boolean).join("\n");
            return <button key={node.id} type="button" aria-label={`Add ${node.label}`} aria-describedby={`${uid}-${node.id}-hint`} disabled={disabled} draggable={!disabled && !capped} title={hint}
              onPointerDown={() => { suppressDragClick.current = false; }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") suppressDragClick.current = false; }}
              onClick={() => { if (suppressDragClick.current) { suppressDragClick.current = false; return; } if (!disabled && !capped) onAdd(node.id); }}
              onDragStart={(event) => {
                clearDragPreview();
                if (event.target !== event.currentTarget || disabled || capped) { event.preventDefault(); return; }
                suppressDragClick.current = true;
                event.dataTransfer.setData(PALETTE_MIME, `catalogue:${node.id}`);
                event.dataTransfer.effectAllowed = "copy";
                if (typeof event.dataTransfer.setDragImage === "function") {
                  const preview = createNodeDragPreview(node);
                  dragPreview.current = preview;
                  // FlowCanvas places the dropped node's top-left at the pointer.
                  event.dataTransfer.setDragImage(preview, 0, 0);
                }
              }}
              onDragEnd={clearDragPreview}
              style={{ userSelect: "none", WebkitUserSelect: "none" }}
              className={cn("group flex w-full select-none items-start gap-2 rounded-2xl bg-background px-3 py-2.5 text-left shadow-ring transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-40", node.kind === "info" && "border border-dashed border-line-3 bg-surface shadow-none", capped && "opacity-60")}>
              <span draggable={false} className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium leading-snug">{node.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-ink-2">{node.description}</span>
                <span className="mt-2 flex items-center gap-1 font-mono text-xs text-ink-3">{node.kind === "round" ? `${ROUND_MINUTES_LABEL} · ${node.difficulty}` : <><Info aria-hidden className="h-3 w-3" />Reference only</>}</span>
                <span id={`${uid}-${node.id}-hint`} className="sr-only">Topics: {node.topics.join(", ")}.{node.keywords.length ? ` Keywords: ${node.keywords.join(", ")}.` : ""}{capped ? " Limit reached; remove a node first." : ""}</span>
              </span>
              <Plus aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
            </button>;
          })}
        </div>
      </section>)}
      {!results.length ? <div className="rounded-2xl border border-dashed border-line-3 px-4 py-6 text-center"><p className="m-0 text-sm">No matching nodes</p><p className="mb-4 mt-2 text-[12.5px] leading-relaxed text-ink-3">Try a technology, interview topic, or another category.</p><button type="button" disabled={disabled} onClick={reset} className="rounded-full px-4 py-2 text-[12.5px] shadow-ring hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">Show all nodes</button></div> : null}
    </div>
    <div className="flex shrink-0 justify-between border-t border-line px-4 py-2.5 font-mono text-xs text-ink-3"><span>{roundCount}/{MAX_ROUND_NODES} rounds</span><span>{infoCount}/{MAX_INFO_NODES} references</span></div>
  </aside>;
}
