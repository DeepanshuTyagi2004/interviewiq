export * from "./types";
export * from "./hooks";
export * from "./graph";
export { NODE_CATEGORIES, NODE_PRESETS, filterNodePresets } from "./presets";
export type { NodePreset } from "./presets";
export * from "./slots";
export * from "./readiness";
export { bookingError } from "./errors";
// Heavy UI (xyflow canvas, dialogs) is imported by path, so pages that only need data hooks
// (the dashboard) don't ship the flow library:
//   "@/features/loops/components/FlowCanvas", "@/features/loops/components/SlotDialog"
