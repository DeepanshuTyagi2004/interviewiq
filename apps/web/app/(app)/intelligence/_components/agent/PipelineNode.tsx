import { Handle, Position, type NodeProps } from "@xyflow/react";
import { STEP_STATUS_COLOR, type PipelineNodeData } from "./stepStatusColor";

/** Custom react-flow node for one pipeline step, colored by that step's status. */
export function PipelineNode({ data }: NodeProps) {
  const nodeData = data as unknown as PipelineNodeData;
  const status = nodeData.status ?? "idle";
  return (
    <div
      style={{
        background: STEP_STATUS_COLOR[status] ?? STEP_STATUS_COLOR.idle,
        border: "1px solid #999",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 12,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div>{nodeData.label}</div>
      <div style={{ opacity: 0.6 }}>{status}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
