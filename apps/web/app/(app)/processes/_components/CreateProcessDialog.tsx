"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/custom-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useJds, useJobCompanies } from "@/features/jobs";
import { newRoundNode, useCreateProcess, useOfficialProcess, useProcesses } from "@/features/loops";
import { ApiFetchError } from "@/lib/api-client/errors";
import { levelLabel } from "@/app/(app)/jobs/_components/library";
import { processHref } from "@/app/(app)/loops/_components/loopUi";
import { ENGINEERING_LEVEL_OPTIONS, isEngineeringLevel, normalizeLegacyLevel, type EngineeringLevel } from "@/lib/constants/engineering-levels";
import { useCandidateProfile } from "@/features/onboarding";

export function CreateProcessDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const companies = useJobCompanies();
  const profile = useCandidateProfile();
  const processes = useProcesses();
  const create = useCreateProcess();
  const submitting = useRef(false);
  const [company, setCompany] = useState("");
  const [jdId, setJdId] = useState("");
  const [copy, setCopy] = useState("blank");
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState("");
  const [level, setLevel] = useState<EngineeringLevel | "">("");
  const jds = useJds({ company: company || undefined }, { enabled: open && copy === "suggested" && Boolean(company) });
  const suggested = useOfficialProcess(copy === "suggested" ? jdId : "");
  const sortedCompanies = useMemo(() => [...(companies.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [companies.data]);
  const source = processes.data?.find((process) => process.id === sourceId);
  const roles = jds.data ?? [];
  const effectiveLevel = level || (copy === "blank" ? normalizeLegacyLevel(profile.data?.level) : null);
  const valid = name.trim() && isEngineeringLevel(effectiveLevel) && (copy === "blank" || (copy === "suggested" ? suggested.data : source));

  function reset() { setCompany(""); setJdId(""); setCopy("blank"); setSourceId(""); setName(""); setLevel(""); }
  function close(next: boolean) { if (create.isPending || submitting.current) return; onOpenChange(next); if (!next) reset(); }
  function submit() {
    if (!valid || !isEngineeringLevel(effectiveLevel) || create.isPending || submitting.current) return;
    submitting.current = true;
    const graph = copy === "suggested" ? suggested.data! : copy === "own" ? source!.graph : { nodes: [newRoundNode("dsa", { x: 0, y: 0 })], edges: [] };
    create.mutate({ name: name.trim(), level: effectiveLevel, graph, ...(copy === "suggested" ? { jdId } : {}) }, {
      onSuccess: (process) => { onOpenChange(false); reset(); router.push(processHref(process.id)); },
      onError: (error) => toast.error(error instanceof ApiFetchError && error.code === "process_limit" ? error.message : "Couldn't create the process. Please try again."),
      onSettled: () => { submitting.current = false; },
    });
  }
  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="max-w-[520px]">
      <DialogHeader><DialogTitle>New interview process</DialogTitle><DialogDescription>Name your process and choose any level. Optionally copy rounds, then edit everything in the canvas. Custom practice does not count towards readiness.</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-[13px] text-ink-2">Name<Input aria-label="Process name" className="text-[13px]" maxLength={120} value={name} disabled={create.isPending} placeholder="My interview practice" onChange={(event) => setName(event.target.value)} /></label>
        <div className="flex flex-col gap-2 text-[13px]"><span className="text-ink-2">Level</span><CustomSelect label="Process level" value={effectiveLevel ?? ""} disabled={create.isPending} options={[{ value: "", label: "Choose a level" }, ...ENGINEERING_LEVEL_OPTIONS]} onValueChange={(value) => { if (isEngineeringLevel(value) || value === "") setLevel(value); }} /></div>
        <div className="space-y-2 text-[13px]"><span className="text-ink-2">Start from</span><CustomSelect label="Start from" value={copy} disabled={create.isPending} onValueChange={(value) => { setCopy(value); setLevel(""); }} options={[{ value: "blank", label: "Blank · one round" }, { value: "suggested", label: "Copy a suggested company / role process" }, { value: "own", label: "Copy one of my processes" }]} /></div>
        {copy === "suggested" ? <>
          <CustomSelect label="Company" value={company} disabled={create.isPending} onValueChange={(value) => { setCompany(value); setJdId(""); }} options={[{ value: "", label: companies.isLoading ? "Loading companies…" : "Select a company" }, ...sortedCompanies.map((item) => ({ value: item.slug, label: item.name }))]} />
          <CustomSelect label="Role" value={jdId} disabled={!company || create.isPending} onValueChange={(value) => { setJdId(value); setLevel(normalizeLegacyLevel(roles.find((role) => role.id === value)?.level) ?? ""); }} options={[{ value: "", label: jds.isLoading ? "Loading roles…" : "Select a role" }, ...roles.map((role) => ({ value: role.id, label: `${role.title} · ${levelLabel(role.level)}` }))]} />
          {suggested.isError ? <p role="alert" className="text-[12.5px] text-destructive">Couldn&apos;t load the suggested rounds. Choose another role or retry.</p> : null}
          <p className="m-0 text-[12.5px] text-ink-3">Suggested rounds are a starting point, not a company-official process.</p>
        </> : copy === "own" ? <><CustomSelect label="My process to copy" value={sourceId} disabled={create.isPending} onValueChange={(value) => { setSourceId(value); const item = processes.data?.find((p) => p.id === value); setLevel(normalizeLegacyLevel(item?.level) ?? ""); }} options={[{ value: "", label: processes.isLoading ? "Loading processes…" : "Select a process" }, ...(processes.data ?? []).map((item) => ({ value: item.id, label: item.name }))]} />{source && !normalizeLegacyLevel(source.level) ? <p className="text-[12.5px] text-ink-2">The saved level is unrecognized. Choose a level before copying.</p> : null}</> : <p className="m-0 text-[12.5px] text-ink-3">Start with one coding round. Add, remove and connect rounds in the editor.</p>}
      </div>
      <div className="mt-2 flex justify-end gap-2"><Button variant="ghost" disabled={create.isPending} onClick={() => close(false)}>Cancel</Button><Button disabled={!valid || create.isPending} onClick={submit}>{create.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}Create and edit</Button></div>
    </DialogContent>
  </Dialog>;
}
