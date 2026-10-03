"use client";

import * as React from "react";
import Link from "next/link";
import { HudCard, Readout } from "@/components/hud";
import { DraftResearchReport } from "./DraftResearchReport";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiFetchError } from "@/lib/api-client/client";
import { timeAgo, useCompanyDraft, useDecideDraft, type AdminCompany, type CompanyDraft } from "@/features/research";

function errorMessage(err: unknown): string {
  return err instanceof ApiFetchError ? err.message : "Something went wrong. Check the API logs.";
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

/** What the research found for one company, with the call to approve (publish) or reject it. */
export function DraftReviewDialog({ company, open, onOpenChange, readOnly = false }: { company: AdminCompany; open: boolean; onOpenChange: (open: boolean) => void; readOnly?: boolean }) {
  const query = useCompanyDraft(company.id, open);
  const decide = useDecideDraft(company.id);
  const [note, setNote] = React.useState("");
  const noteId = React.useId();
  const draft = query.data?.draft ?? null;
  const pending = !readOnly && draft?.status === "pending_review";
  const archived = company.status === "archived" || query.data?.company.status === "archived";
  const blocked = draft?.conflicts.some((c) => c.type === "not_a_company") ?? false;

  function submit(decision: "approve" | "reject") {
    if (!draft || !pending || decide.isPending || (decision === "approve" && (blocked || archived))) return;
    decide.mutate(
      { draftId: draft.draft_id, decision, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(decision === "approve" ? `${company.name} published` : "Draft rejected");
          setNote("");
          onOpenChange(false);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-line-2 p-4 pr-12 text-left sm:p-6 sm:pr-12">
          <DialogTitle className="break-words leading-snug">{pending && !archived ? "Review research" : "Company research"} · {company.name}</DialogTitle>
          <DialogDescription>
            {draft
              ? `Draft v${draft.version} · ${draft.status.replace("_", " ")} · ${timeAgo(draft.created_at)}`
              : "The latest research draft for this company."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        {readOnly ? <p className="mb-5 mt-0 text-sm text-muted-foreground">Read-only research suggestions. Nothing here overwrites your enrichment draft. Review sources before entering information in the editor.</p> : null}
        {query.isLoading ? (
          <p className="m-0 text-[13px] text-muted-foreground">Loading draft…</p>
        ) : query.isError || !draft ? (
          <p role="alert" className="m-0 text-[13px] text-muted-foreground">
            {query.error instanceof ApiFetchError && query.error.status === 404 ? "No draft yet. Run research for this company first." : errorMessage(query.error)}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <HudCard title="Draft record" bodyClassName="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Readout size="sm" label="Version" value={`v${draft.version}`} />
              <Readout size="sm" label="Status" value={draft.status.replace(/_/g, " ")} />
              <Readout size="sm" label="Created" value={timeAgo(draft.created_at)} note={draft.created_at} />
              <Readout size="sm" label="Draft ID" value={<span className="break-all leading-snug">{draft.draft_id}</span>} />
              <Readout size="sm" label="Research run" value={<Link className="break-all leading-snug underline underline-offset-4" href={`/intelligence?tab=runs&run=${encodeURIComponent(draft.run_id)}`}>{draft.run_id}</Link>} />
              <Readout size="sm" label="Decision" value={draft.decided_at ? timeAgo(draft.decided_at) : "Not recorded"} note={[draft.decided_at, draft.decided_by].filter(Boolean).join(" · ")} className="break-words" />
            </HudCard>
            {archived ? <p className="m-0 text-sm text-muted-foreground">This company is archived. Restore it before approving a draft.</p> : null}
            {draft.conflicts.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {draft.conflicts.map((c, i) => (
                  <li key={i} role="alert" className="text-[13px] text-destructive">
                    <span className="font-mono text-[11px] uppercase">{c.type.replace(/_/g, " ")}</span> · {c.message}
                  </li>
                ))}
              </ul>
            ) : null}

            <DraftResearchReport draft={draft} company={query.data?.company ?? company} />

            <ChangeList draft={draft} />

            {pending ? (
              <div className="flex flex-col gap-2">
                <label htmlFor={noteId} className="iq-eyebrow">Decision note (optional)</label>
                <Textarea id={noteId} value={note} disabled={decide.isPending} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Kept with the decision" rows={2} />
              </div>
            ) : draft.decision_note ? (
              <p className="m-0 text-[13px] text-muted-foreground">Note: {draft.decision_note}</p>
            ) : null}
          </div>
        )}
        </div>

        <DialogFooter className="shrink-0 flex-row flex-wrap gap-2 border-t border-line-2 p-4 sm:space-x-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {pending ? (
            <>
              <Button variant="strong" disabled={decide.isPending} onClick={() => submit("reject")}>Reject</Button>
              <Button disabled={decide.isPending || blocked || archived} title={archived ? "Restore this company before approving." : blocked ? "Research says this is not a company. Reject it." : undefined} onClick={() => submit("approve")}>
                Approve and publish
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeList({ draft }: { draft: CompanyDraft }) {
  if (draft.diff.length === 0) return <p className="m-0 text-[12px] text-faint">No changes against the last approved draft.</p>;
  return (
    <HudCard title="Changes vs last approved draft" bodyClassName="flex flex-col gap-4 p-4">
      {draft.diff.map((d) => (
        <div key={d.path} className="min-w-0">
          <p className="mb-2 mt-0 break-all font-mono text-xs">{d.change} · {d.path}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[{ label: "Before", value: d.before }, { label: "After", value: d.after }].map(({ label, value }) => (
              <div key={label} className="min-w-0 rounded-lg border border-line-2 p-3">
                <span className="iq-eyebrow">{label}</span>
                <pre className="mb-0 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{show(value)}</pre>
              </div>
            ))}
          </div>
        </div>
      ))}
    </HudCard>
  );
}
