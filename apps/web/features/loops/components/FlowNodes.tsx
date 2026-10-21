"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Check, Clock, Info, Lock } from "lucide-react";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { Chip, StatusDot } from "@/components/ds";
import { formatScore } from "@/features/report/presentation";
import { ROUND_MINUTES_LABEL } from "@/lib/constants/interview";
import { cn } from "@/lib/utils/cn";
import { roundTypeLabel } from "../graph";
import type { InfoNode, LoopNodeState, NodeResult, RoundNode } from "../types";

export type RoundFlowData = {
  node: RoundNode;
  index: number;
  state?: LoopNodeState;
  /** Latest finished attempt (score, pass mark, retake date), when there is one. */
  result?: NodeResult;
  /** Edit mode shows connection handles; view mode hides them. */
  editable: boolean;
  onBook?: (nodeId: string) => void;
  /** The viewer may not take interviews: the Book button gives way to an access note. */
  bookBlocked?: boolean;
};
export type InfoFlowData = { node: InfoNode };
export type RoundFlowNode = Node<RoundFlowData, "round">;
export type InfoFlowNodeT = Node<InfoFlowData, "info">;

const STATE_META: Record<LoopNodeState, { label: string; icon: typeof Lock; cls: string }> = {
  locked: { label: "Locked", icon: Lock, cls: "text-ink-3" },
  available: { label: "Ready to book", icon: Clock, cls: "text-ink" },
  booked: { label: "Booked", icon: Clock, cls: "text-ink" },
  evaluating: { label: "Grading", icon: Clock, cls: "text-ink" },
  passed: { label: "Passed", icon: Check, cls: "" },
  cooldown: { label: "Retake", icon: Clock, cls: "text-ink-2" },
  completed: { label: "Completed", icon: Check, cls: "" },
};

/** "25 Oct": the day a retake opens, in the viewer's locale. */
export function retakeDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The state label shown on a round node, with its score where there is one (spec §12.2). */
export function nodeStateLabel(state: LoopNodeState, result?: NodeResult): string {
  switch (state) {
    case "passed":
      return result?.score != null && result.passMark != null
        ? `Passed · ${formatScore(result.score)} / ${formatScore(result.passMark)}`
        : "Passed";
    case "cooldown": {
      const date = result?.retakeAfter ? retakeDate(result.retakeAfter) : "";
      return date ? `Retake from ${date}` : "Retake later";
    }
    case "completed":
      return "Completed · Not scored";
    default:
      return STATE_META[state].label;
  }
}

const handleCls = "!h-2.5 !w-2.5 !border-ink-3 !bg-background";

/**
 * Monochrome node look per state (spec §5.3): done = ink fill, ready = 1.5px ink ring,
 * locked = dashed line border, cooldown = hollow (lighter) ring plus a date chip.
 */
const NODE_LOOK = {
  done: "bg-ink text-background",
  ready: "bg-background text-ink shadow-[inset_0_0_0_1.5px_hsl(var(--ink))]",
  locked: "border border-dashed border-line-4 bg-transparent text-ink-3",
  cooldown: "bg-background text-ink shadow-[inset_0_0_0_1.5px_hsl(var(--ink-3))]",
  plain: "bg-background text-ink shadow-ring",
} as const;

function lookFor(state?: LoopNodeState): keyof typeof NODE_LOOK {
  switch (state) {
    case "passed":
    case "completed":
      return "done";
    case "available":
    case "booked":
    case "evaluating":
      return "ready";
    case "locked":
      return "locked";
    case "cooldown":
      return "cooldown";
    default:
      return "plain";
  }
}

export function RoundFlowNodeView({ data, selected }: NodeProps<RoundFlowNode>) {
  const { node, index, state, result, editable, onBook, bookBlocked: interviewBlocked = false } = data;
  const meta = state ? STATE_META[state] : null;
  const look = lookFor(state);
  const done = look === "done";
  const quiet = done ? "opacity-70" : look === "locked" ? "" : "text-ink-2";
  return (
    <div
      className={cn(
        "w-[230px] rounded-[16px] p-4 text-left transition-colors",
        NODE_LOOK[look],
        selected && "outline outline-2 outline-offset-2 outline-ink",
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={editable} className={cn(handleCls, !editable && "!opacity-0")} />
      <p className="m-0 flex items-center justify-between gap-2 text-[11px] font-medium tracking-[0.02em]">
        <span className={quiet}>Round {String(index + 1).padStart(2, "0")}</span>
        {meta && state === "evaluating" ? (
          <StatusDot state="active" label={nodeStateLabel(state)} className={cn("text-[11px]", meta.cls)} />
        ) : meta && state === "cooldown" ? (
          <Chip tone="outline" dot="hollow" className="h-5 px-2 text-[11px]">
            {nodeStateLabel(state, result)}
          </Chip>
        ) : meta && state ? (
          <span className={cn("inline-flex items-center gap-1", meta.cls)}>
            <meta.icon aria-hidden className="h-3 w-3" />
            {nodeStateLabel(state, result)}
          </span>
        ) : null}
      </p>
      <p className="m-0 mt-2 text-sm font-medium leading-snug">{node.name || "Untitled round"}</p>
      <p className={cn("m-0 mt-1 text-[11.5px]", quiet)}>
        {roundTypeLabel(node.type)} · {ROUND_MINUTES_LABEL} · {node.difficulty}
      </p>
      {node.topics.length > 0 ? (
        <p className={cn("m-0 mt-2 line-clamp-2 text-[11.5px] leading-[1.4]", done ? "opacity-60" : "text-ink-3")}>{node.topics.join(" · ")}</p>
      ) : null}
      {state === "available" && onBook && interviewBlocked ? <InterviewAccessNote className="mt-3" /> : null}
      {state === "available" && onBook && !interviewBlocked ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onBook(node.id); }}
          className="nodrag nopan mt-3 h-8 w-full rounded-full bg-ink text-[12.5px] font-medium text-background transition-colors hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
      className="group/info relative w-[230px] cursor-not-allowed rounded-[16px] border border-dashed border-line-4 bg-transparent p-4 text-left text-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="m-0 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.02em]">
        <Info aria-hidden className="h-3 w-3" />
        Info only
      </p>
      <p className="m-0 mt-2 text-sm leading-snug text-ink-2">{node.name}</p>
      {node.note ? <p className="m-0 mt-1 line-clamp-3 text-[11.5px] leading-[1.4]">{node.note}</p> : null}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2.5 py-1.5 text-[11.5px] text-background opacity-0 shadow-float transition-opacity group-hover/info:opacity-100 group-focus-visible/info:opacity-100"
      >
        Not an interview round, for information only
      </span>
    </div>
  );
}
