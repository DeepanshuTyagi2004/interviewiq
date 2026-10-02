import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils/cn";
import { STEP_STATUS_CLASS, type PipelineNodeData } from "./stepStatusColor";

/** Custom react-flow node for one pipeline step: hairline chrome by status, mono labels. */
export function PipelineNode({ data }: NodeProps) {
  const nodeData = data as unknown as PipelineNodeData;
  const status = nodeData.status ?? "idle";
  return (
    <div
      className={cn(
        "min-w-[84px] cursor-pointer rounded-[9px] border px-2.5 py-1.5 shadow-hairline transition-colors",
        STEP_STATUS_CLASS[status] ?? STEP_STATUS_CLASS.idle,
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-mono text-[11.5px] leading-tight">{nodeData.label}</div>
      <div className="mt-1 flex items-center gap-1 font-mono text-[9px] uppercase leading-none tracking-[0.06em] opacity-75">
        {status === "running" ? (
          <span
            aria-hidden
            data-motion
            className="h-1 w-1 animate-[iq-breathe_1.4s_ease-in-out_infinite] rounded-full bg-brand"
          />
        ) : null}
        {status}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
