"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useJds, useJobCompanies } from "@/features/jobs";
import { newRoundNode, useCreateProcess } from "@/features/loops";
import { ApiFetchError } from "@/lib/api-client/errors";
import { cn } from "@/lib/utils/cn";
import { levelLabel } from "@/app/(app)/jobs/_components/library";
import { processHref } from "@/app/(app)/loops/_components/loopUi";

const field = "h-10 w-full rounded-full border border-line-4 bg-card px-4 text-[13.5px] text-foreground transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
const choice = (on: boolean) =>
  cn(
    "flex-1 rounded-xl border px-3.5 py-3 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
    on ? "border-foreground bg-panel" : "border-line-3 hover:border-faint-2",
  );

type Start = "suggested" | "blank";

/**
 * New process: pick the role it's for, start from that role's suggested process or from a single
 * round, name it, then continue in the editor. Processes are always tied to one role.
 */
export function CreateProcessDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const companies = useJobCompanies();
  const create = useCreateProcess();
  const [company, setCompany] = useState("");
  const [jdId, setJdId] = useState("");
  const [start, setStart] = useState<Start>("suggested");
  const [name, setName] = useState("");
  const jds = useJds({ company: company || undefined }, { enabled: Boolean(company) });

  const sortedCompanies = useMemo(() => [...(companies.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [companies.data]);
  const roles = jds.data ?? [];
  const jd = roles.find((j) => j.id === jdId);
  const defaultName = jd ? `${jd.companyName} · ${jd.title} (custom)`.slice(0, 120) : "";
  const finalName = (name.trim() || defaultName).slice(0, 120);

  function reset() {
    setCompany(""); setJdId(""); setStart("suggested"); setName("");
  }

  function submit() {
    if (!jd || !finalName) return;
    create.mutate(
      {
        jdId: jd.id,
        name: finalName,
        ...(start === "blank" ? { graph: { nodes: [newRoundNode("dsa", { x: 0, y: 0 })], edges: [] } } : {}),
      },
      {
        onSuccess: (p) => { onOpenChange(false); reset(); router.push(processHref(p.id)); },
        onError: (err) => toast.error(err instanceof ApiFetchError && err.code === "process_limit" ? err.message : "Couldn't create the process. Please try again."),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New interview process</DialogTitle>
          <DialogDescription>
            A process belongs to one role. Custom processes are standalone practice: fully analysed, never counted towards readiness.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-[13px]">
            Company
            <select aria-label="Company" className={field} value={company} onChange={(e) => { setCompany(e.target.value); setJdId(""); }}>
              <option value="">{companies.isLoading ? "Loading companies…" : "Select a company"}</option>
              {sortedCompanies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-[13px]">
            Role
            <select aria-label="Role" className={field} value={jdId} disabled={!company} onChange={(e) => setJdId(e.target.value)}>
              <option value="">{!company ? "Pick a company first" : jds.isLoading ? "Loading roles…" : roles.length ? "Select a role" : "No roles yet"}</option>
              {roles.map((j) => <option key={j.id} value={j.id}>{j.title} · {levelLabel(j.level)}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-2 text-[13px]">
            Start from
            <div role="radiogroup" aria-label="Start from" className="flex gap-2">
              <button type="button" role="radio" aria-checked={start === "suggested"} onClick={() => setStart("suggested")} className={choice(start === "suggested")}>
                Suggested process
                <span className="mt-0.5 block text-xs text-muted-foreground">The role&apos;s researched rounds, ready to edit</span>
              </button>
              <button type="button" role="radio" aria-checked={start === "blank"} onClick={() => setStart("blank")} className={choice(start === "blank")}>
                Blank
                <span className="mt-0.5 block text-xs text-muted-foreground">One DSA round; build the rest yourself</span>
              </button>
            </div>
          </div>
          <label className="flex flex-col gap-2 text-[13px]">
            Name
            <input aria-label="Process name" className={field} maxLength={120} placeholder={defaultName || "Name your process"} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!jd || !finalName || create.isPending} onClick={submit}>
            {create.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            Create and edit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
