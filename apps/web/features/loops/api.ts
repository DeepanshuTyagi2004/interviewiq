import { apiFetch } from "@/lib/api-client/client";
import { LOOP_ENDPOINTS } from "@/lib/constants/loops";
import type { InterviewProcess, JdLoopStatus, Loop, LoopStatus, ProcessGraph, TargetEntry } from "./types";

export const listLoops = () => apiFetch<{ loops: Loop[] }>(LOOP_ENDPOINTS.loops).then((r) => r.loops);
export const getLoop = (id: string) => apiFetch<Loop>(LOOP_ENDPOINTS.loop(id));
export const confirmLoop = (body: { jdId: string; processId?: string | null }) =>
  apiFetch<Loop>(LOOP_ENDPOINTS.loops, { method: "POST", json: body });
export const setLoopStatus = (id: string, status: Exclude<LoopStatus, "completed">) =>
  apiFetch<Loop>(LOOP_ENDPOINTS.loop(id), { method: "PATCH", json: { status } });

export const listProcesses = () => apiFetch<{ processes: InterviewProcess[] }>(LOOP_ENDPOINTS.processes).then((r) => r.processes);
export const getProcess = (id: string) => apiFetch<InterviewProcess>(LOOP_ENDPOINTS.process(id));
export const createProcess = (body: { jdId: string; name: string; graph?: ProcessGraph }) =>
  apiFetch<InterviewProcess>(LOOP_ENDPOINTS.processes, { method: "POST", json: body });
export const updateProcess = (id: string, body: { name?: string; graph?: ProcessGraph }) =>
  apiFetch<InterviewProcess>(LOOP_ENDPOINTS.process(id), { method: "PUT", json: body });
export const duplicateProcess = (id: string) => apiFetch<InterviewProcess>(LOOP_ENDPOINTS.duplicate(id), { method: "POST" });
export const deleteProcess = (id: string) => apiFetch<void>(LOOP_ENDPOINTS.process(id), { method: "DELETE" });
export const getOfficialProcess = (jdId: string) => apiFetch<{ graph: ProcessGraph }>(LOOP_ENDPOINTS.official(jdId)).then((r) => r.graph);

export const listTargets = () => apiFetch<{ targets: TargetEntry[] }>(LOOP_ENDPOINTS.targets).then((r) => r.targets);
export const addTarget = (jdId: string) => apiFetch<void>(LOOP_ENDPOINTS.target(jdId), { method: "PUT" });
export const removeTarget = (jdId: string) => apiFetch<void>(LOOP_ENDPOINTS.target(jdId), { method: "DELETE" });
export const getJdLoopStatus = (jdId: string) => apiFetch<JdLoopStatus>(LOOP_ENDPOINTS.jdStatus(jdId));
