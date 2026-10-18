"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Check, Clock, Info, Lock } from "lucide-react";
import { ROUND_MINUTES_LABEL } from "@/lib/constants/interview";
import { cn } from "@/lib/utils/cn";
import { roundTypeLabel } from "../graph";
import type { InfoNode, LoopNodeState, RoundNode } from "../types";

export type RoundFlowData = {
  node: RoundNode;
  index: number;
  state?: LoopNodeState;
  /** Edit mode shows connection handles; view mode hides them. */
  editable: boolean;
  onBook?: (nodeId: string) => void;
};
export type InfoFlowData = { node: InfoNode };
export type RoundFlowNode = Node<RoundFlowData, "round">;
export type InfoFlowNodeT = Node<InfoFlowData, "info">;

const STATE_META: Record<LoopNodeState, { label: string; icon: typeof Lock; cls: string }> = {
  locked: { label: "Locked", icon: Lock, cls: "text-faint" },
  available: { label: "Ready to book", icon: Clock, cls: "text-brand" },
  booked: { label: "Booked", icon: Clock, cls: "text-foreground" },
  completed: { label: "Completed", icon: Check, cls: "text-foreground" },
};

const handleCls = "!h-2.5 !w-2.5 !border-line-4 !bg-card";

export function RoundFlowNodeView({ data, selected }: NodeProps<RoundFlowNode>) {
  const { node, index, state, editable, onBook } = data;
  const meta = state ? STATE_META[state] : null;
  return (
    <div
      className={cn(
        "w-[230px] rounded-xl border bg-card p-4 text-left text-foreground shadow-float transition-colors",
        selected ? "border-brand" : "border-line-3",
        state === "locked" && "opacity-70",
        state === "completed" && "border-foreground/40",
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={editable} className={cn(handleCls, !editable && "!opacity-0")} />
      <p className="m-0 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>Round {String(index + 1).padStart(2, "0")}</span>
        {meta ? (
          <span className={cn("inline-flex items-center gap-1", meta.cls)}>
            <meta.icon aria-hidden className="h-3 w-3" />
            {meta.label}
          </span>
        ) : null}
      </p>
      <p className="m-0 mt-2 text-sm leading-snug">{node.name || "Untitled round"}</p>
      <p className="m-0 mt-1 font-mono text-[11px] text-muted-foreground">
        {roundTypeLabel(node.type)} · {ROUND_MINUTES_LABEL} · {node.difficulty}
      </p>
      {node.topics.length > 0 ? (
        <p className="m-0 mt-2 line-clamp-2 text-[11.5px] leading-[1.4] text-faint">{node.topics.join(" · ")}</p>
      ) : null}
      {state === "available" && onBook ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onBook(node.id); }}
          className="nodrag nopan mt-3 h-8 w-full rounded-full bg-brand text-[12.5px] text-brand-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Book this round
        </button>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={editable} className={cn(handleCls, !editable && "!opacity-0")} />
    </div>
  );
}

/**
 * A non-interview step (online test, take-home…). Disabled on purpose: no handles, never counted,
 * and hovering explains why.
 */
export function InfoFlowNodeView({ data }: NodeProps<InfoFlowNodeT>) {
  const { node } = data;
  return (
    <div
      tabIndex={0}
      aria-label={`${node.name}. Not an interview round, for information only.`}
      className="group/info relative w-[230px] cursor-not-allowed rounded-xl border border-dashed border-line-4 bg-panel/60 p-4 text-left opacity-65 outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <p className="m-0 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <Info aria-hidden className="h-3 w-3" />
        Info only
      </p>
      <p className="m-0 mt-2 text-sm leading-snug">{node.name}</p>
      {node.note ? <p className="m-0 mt-1 line-clamp-3 text-[11.5px] leading-[1.4] text-faint">{node.note}</p> : null}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-3 bg-card px-2.5 py-1.5 text-[11.5px] text-foreground opacity-0 shadow-float transition-opacity group-hover/info:opacity-100 group-focus-visible/info:opacity-100"
      >
        Not an interview round, for information only
      </span>
    </div>
  );
}
