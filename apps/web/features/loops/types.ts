/** Loop types, derived from the generated OpenAPI schema (never hand-written). */
import type { components } from "@/lib/api-client/generated/schema";

type S = components["schemas"];

export type ProcessGraph = S["ProcessGraph"];
export type ProcessNode = ProcessGraph["nodes"][number];
export type ProcessEdge = ProcessGraph["edges"][number];
export type RoundNode = S["ProcessRoundNode"];
export type InfoNode = S["ProcessInfoNode"];
export type JdBrief = S["JdBrief"];
export type InterviewProcess = S["InterviewProcess"];
export type Loop = S["Loop"];
export type LoopNodeState = S["LoopNodeState"];
export type LoopStatus = Loop["status"];
export type TargetEntry = S["TargetList"]["targets"][number];
export type JdLoopStatus = S["JdLoopStatus"];

export const isRoundNode = (n: ProcessNode): n is RoundNode => n.kind === "round";
export type ReadinessLevel = S["ReadinessLevel"];
/** The latest finished attempt of a round node: score, pass mark and the retake date. */
export type NodeResult = Loop["nodeResults"][string];
