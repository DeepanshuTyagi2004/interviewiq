"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INTERVIEW_QUERY_KEYS } from "@/lib/constants/interview";
import { LOOP_QUERY_KEYS } from "@/lib/constants/loops";
import * as api from "./api";
import type { LoopStatus } from "./types";

export const useLoops = () => useQuery({ queryKey: LOOP_QUERY_KEYS.loops, queryFn: api.listLoops });
export const useLoop = (id: string) => useQuery({ queryKey: LOOP_QUERY_KEYS.loop(id), queryFn: () => api.getLoop(id), enabled: !!id });
export const useProcesses = () => useQuery({ queryKey: LOOP_QUERY_KEYS.processes, queryFn: api.listProcesses });
export const useProcess = (id: string) => useQuery({ queryKey: LOOP_QUERY_KEYS.process(id), queryFn: () => api.getProcess(id), enabled: !!id });
export const useOfficialProcess = (jdId: string) =>
  useQuery({ queryKey: LOOP_QUERY_KEYS.official(jdId), queryFn: () => api.getOfficialProcess(jdId), enabled: !!jdId });
export const useTargets = () => useQuery({ queryKey: LOOP_QUERY_KEYS.targets, queryFn: api.listTargets });
export const useJdLoopStatus = (jdId: string) =>
  useQuery({ queryKey: LOOP_QUERY_KEYS.jdStatus(jdId), queryFn: () => api.getJdLoopStatus(jdId), enabled: !!jdId });

/** Everything that depends on loops/sessions/targets refreshes together, so the dashboard stays in step. */
function useInvalidateLoops() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["loops"] });
    void qc.invalidateQueries({ queryKey: INTERVIEW_QUERY_KEYS.sessions });
  };
}

export function useConfirmLoop() {
  const done = useInvalidateLoops();
  return useMutation({ mutationFn: api.confirmLoop, onSuccess: done });
}

export function useSetLoopStatus() {
  const done = useInvalidateLoops();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Exclude<LoopStatus, "completed"> }) => api.setLoopStatus(id, status),
    onSuccess: done,
  });
}

export function useCreateProcess() {
  const done = useInvalidateLoops();
  return useMutation({ mutationFn: api.createProcess, onSuccess: done });
}

export function useUpdateProcess() {
  const done = useInvalidateLoops();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string; name?: string; graph?: Parameters<typeof api.updateProcess>[1]["graph"] }) => api.updateProcess(id, body), onSuccess: done });
}

export function useDuplicateProcess() {
  const done = useInvalidateLoops();
  return useMutation({ mutationFn: api.duplicateProcess, onSuccess: done });
}

export function useDeleteProcess() {
  const done = useInvalidateLoops();
  return useMutation({ mutationFn: api.deleteProcess, onSuccess: done });
}

export function useToggleTarget() {
  const done = useInvalidateLoops();
  return useMutation({
    mutationFn: ({ jdId, targeted }: { jdId: string; targeted: boolean }) => (targeted ? api.removeTarget(jdId) : api.addTarget(jdId)),
    onSuccess: done,
  });
}
