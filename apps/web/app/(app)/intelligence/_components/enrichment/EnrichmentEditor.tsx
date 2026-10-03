"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HudCard, Readout } from "@/components/hud";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiFetchError } from "@/lib/api-client/client";
import { RESEARCH_QUERY_KEYS } from "@/lib/constants/research";
import { useAdminCompanies } from "@/features/research";
import { cleanDocument, enrichmentKey, getEnrichment, newRole, prefillEnrichment, publicationIssues, publishEnrichment, saveEnrichment, type EnrichmentDocument, type EnrichmentResponse } from "@/features/research/enrichment";
import { DraftReviewDialog } from "../research/DraftReviewDialog";
import { ListField, TextField, VerifiedField } from "./Fields";
import { RoleEditor } from "./RoleEditor";

function message(error: unknown) {
  return error instanceof Error ? error.message : "The request failed. Please try again.";
}

export function EnrichmentEditor({ companyId }: { companyId: string }) {
  const query = useQuery({ queryKey: enrichmentKey(companyId), queryFn: () => getEnrichment(companyId), retry: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 0 });
  return <div className={PAGE_SCAFFOLD}>
    {query.isLoading ? <p role="status">Loading enrichment draft…</p> : query.data ? <EditorSession key={companyId} companyId={companyId} initial={query.data} /> : <HudCard title="Enrichment unavailable" bodyClassName="space-y-4 p-6"><p role="alert">{message(query.error)}</p><Button variant="strong" onClick={() => query.refetch()}>Retry loading</Button><Button asChild variant="ghost"><Link href="/intelligence?tab=companies">Back to companies</Link></Button></HudCard>}
  </div>;
}

function EditorSession({ companyId, initial }: { companyId: string; initial: EnrichmentResponse }) {
  const queryClient = useQueryClient();
  const companies = useAdminCompanies();
  const company = companies.data?.companies.find((c) => c.id === companyId);
  const [saved, setSaved] = useState(initial);
  const [document, setDocument] = useState<EnrichmentDocument>(initial.document);
  const [selectedId, setSelectedId] = useState<string | null>(initial.document.roles[0]?.id ?? null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [confirmPrefill, setConfirmPrefill] = useState(false);
  const prefillInFlight = useRef(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = JSON.stringify(document) !== JSON.stringify(saved.document);
  const role = document.roles.find((r) => r.id === selectedId) ?? document.roles[0];
  const issues = publicationIssues(document);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const write = useMutation({
    retry: false,
    onMutate: () => { prefill.reset(); },
    mutationFn: (publish: boolean) => (publish ? publishEnrichment : saveEnrichment)(companyId, { revision: saved.revision, document: cleanDocument(document) }),
    onSuccess: (result, published) => {
      // Adopt the canonical server document, including linked JD IDs after publication.
      setSaved(result);
      setDocument(result.document);
      queryClient.setQueryData(enrichmentKey(companyId), result);
      queryClient.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.companies });
      if (published) queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setConfirmPublish(false);
      prefill.reset();
      setNotice(published ? "Published. The verified company, roles and rounds are public now." : "Draft saved. You can reopen it from Companies.");
    },
  });
  const prefill = useMutation({
    retry: false,
    onMutate: () => { write.reset(); },
    mutationFn: () => prefillEnrichment(companyId, { revision: saved.revision }),
    onSuccess: (result) => {
      const changed = JSON.stringify(result.document) !== JSON.stringify(saved.document);
      setSaved(result);
      setDocument(result.document);
      setSelectedId((current) => result.document.roles.some((r) => r.id === current) ? current : result.document.roles[0]?.id ?? null);
      queryClient.setQueryData(enrichmentKey(companyId), result);
      queryClient.invalidateQueries({ queryKey: RESEARCH_QUERY_KEYS.companies });
      write.reset();
      setNotice(changed ? "Research prefilled for review. Added content and sources are still unverified; review and edit them before verifying. Nothing was published." : "No additional sourced research could fill the missing fields. Your content is unchanged; remaining blanks need research or manual additions.");
    },
    onSettled: () => { prefillInFlight.current = false; setConfirmPrefill(false); },
  });
  const reload = useMutation({ mutationFn: () => getEnrichment(companyId), retry: false, onSuccess: (result) => {
    setSaved(result); setDocument(result.document); setSelectedId(result.document.roles[0]?.id ?? null); setConfirmReload(false); write.reset(); prefill.reset(); setNotice("Latest saved draft loaded.");
  } });
  const pending = write.isPending || reload.isPending || prefill.isPending;
  const actionError = prefill.error ?? write.error;
  const conflict = actionError instanceof ApiFetchError && actionError.status === 409;
  const editCompany = (patch: Partial<EnrichmentDocument["company"]>) => { setNotice(null); setDocument((prev) => ({ ...prev, company: { ...prev.company, ...patch, verified: false } })); };

  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ revision: saved.revision, document }, null, 2)], { type: "application/json" }));
    const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `company-${companyId}-unsaved.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="iq-eyebrow m-0">Intelligence / company enrichment</p><h1 className="mb-0 mt-2 text-3xl font-normal tracking-tight">{company?.name ?? "Enrich company"}</h1><p className="mb-0 mt-2 max-w-2xl text-sm text-muted-foreground">Curate company information, role profiles and interview rounds. Save privately, verify each section, then submit to publish immediately.</p></div>
      <Button asChild variant="ghost"><Link href="/intelligence?tab=companies" onClick={(event) => { if (pending || (dirty && !window.confirm("Leave this editor? Unsaved changes will be lost."))) event.preventDefault(); }}>Back to companies</Link></Button>
    </header>

    <HudCard title="Publication record" bodyClassName="grid gap-5 p-5 sm:grid-cols-3">
      <Readout size="sm" label="Draft revision" value={String(saved.revision)} note={dirty ? "Unsaved changes" : "Saved document"} />
      <Readout size="sm" label="Published revision" value={saved.publishedRevision === null ? "Not published" : String(saved.publishedRevision)} note={saved.publishedAt ? new Date(saved.publishedAt).toLocaleString() : undefined} />
      <Readout size="sm" label="Verified by" value={<span className="break-all text-sm">{saved.verifiedBy ?? "Not submitted"}</span>} />
    </HudCard>

    {notice ? <p role="status" className="rounded-lg border border-line-2 bg-panel p-4 text-sm">{notice}</p> : null}
    {actionError ? <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-4 text-sm">
      <p className="m-0">{conflict ? "This draft changed in another session. Your unsaved edits are still here. Download them before loading the latest saved draft, then reconcile your changes." : message(actionError)}</p>
      {conflict ? <div className="flex flex-wrap gap-2"><Button variant="strong" onClick={downloadDraft}>Download my edits</Button><Button variant="strong" onClick={() => setConfirmReload(true)}>Load latest draft…</Button></div> : null}
    </div> : null}
    {company?.status === "archived" ? <p role="alert">This company is archived. Restore it in Companies before publishing.</p> : null}

    <fieldset disabled={pending} className="m-0 min-w-0 space-y-6 border-0 p-0">
      <HudCard title="Company information" bodyClassName="space-y-5 p-5 sm:p-6" action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="strong" disabled={pending || dirty || conflict} aria-describedby="research-prefill-hint" onClick={() => setConfirmPrefill(true)}>{prefill.isPending ? "Filling from research…" : "Fill missing from research"}</Button>{company?.research?.latestDraftId ? <Button size="sm" variant="ghost" onClick={() => setResearchOpen(true)}>View research suggestions</Button> : null}</div>}>
        <p className="m-0 text-sm text-muted-foreground">Collected facts are prefilled where available for your review and editing. Remaining blanks need research or manual additions. Research content and sources stay unverified until you check them.</p>
        <p id="research-prefill-hint" className="m-0 text-xs text-muted-foreground">{dirty ? "Save draft first to fill missing fields from research." : "Fill missing fields from the latest collected research while preserving existing content and verified sections."}</p>
        <TextField label="Company overview" multiline value={document.company.overview} onChange={(overview) => editCompany({ overview })} />
        <div className="grid gap-5 lg:grid-cols-2"><TextField label="Culture" multiline value={document.company.culture} onChange={(culture) => editCompany({ culture })} /><TextField label="Benefits" multiline value={document.company.benefits} onChange={(benefits) => editCompany({ benefits })} /></div>
        <ListField label="Company source URLs" value={document.company.sourceUrls} onChange={(sourceUrls) => editCompany({ sourceUrls })} />
        <VerifiedField label="I verified the company overview, culture, benefits and sources." checked={document.company.verified} onChange={(verified) => setDocument((prev) => ({ ...prev, company: { ...prev.company, verified } }))} />
      </HudCard>

      <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
        <HudCard title="Role profiles" bodyClassName="space-y-3 p-4">
          <p className="m-0 text-xs text-muted-foreground">Company jobs and their interview processes.</p>
          <div className="space-y-2" role="group" aria-label="Role profiles">{document.roles.map((r, index) => <button type="button" key={r.id} aria-pressed={role?.id === r.id} onClick={() => setSelectedId(r.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${role?.id === r.id ? "border-brand bg-brand/5" : "border-line-2"}`}><span className="mb-1 block font-mono text-[10px] text-muted-foreground">{String(index + 1).padStart(2, "0")} · {r.verified ? "VERIFIED" : "DRAFT"}</span>{r.title || "Untitled role"}</button>)}</div>
          <Button variant="strong" className="w-full" disabled={document.roles.length >= 50} onClick={() => { const added = newRole(); setDocument((prev) => ({ ...prev, roles: [...prev.roles, added] })); setSelectedId(added.id); }}>Add role profile</Button>
          {role ? <Button variant="ghost" className="w-full" onClick={() => { if (window.confirm(`Remove ${role.title || "this role"} and all its rounds from this draft?`)) setDocument((prev) => ({ ...prev, roles: prev.roles.filter((r) => r.id !== role.id) })); }}>Remove role profile</Button> : null}
        </HudCard>
        {role ? <RoleEditor key={role.id} role={role} disabled={pending} onChange={(updated) => { setNotice(null); setDocument((prev) => ({ ...prev, roles: prev.roles.map((r) => r.id === updated.id ? updated : r) })); }} /> : <HudCard title="Build the interview process" bodyClassName="p-8"><p className="text-sm text-muted-foreground">Add a role profile to enter a job description and build its interview rounds.</p></HudCard>}
      </div>
    </fieldset>

    <div className="sticky bottom-0 z-20 space-y-3 rounded-xl border border-line-2 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 text-sm text-muted-foreground">{prefill.isPending ? "Filling from research…" : reload.isPending ? "Loading…" : pending ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"} · Editing content clears its verification.</p><div className="flex gap-2"><Button variant="strong" disabled={pending || conflict} onClick={() => { setNotice(null); write.mutate(false); }}>{write.isPending && !write.variables ? "Saving draft…" : "Save draft"}</Button><Button disabled={pending || conflict || issues.length > 0 || company?.status === "archived"} onClick={() => setConfirmPublish(true)}>Submit & publish</Button></div></div>
      {issues.length ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Before publishing · {issues.length} checks remaining</summary><ul className="mb-0 space-y-1">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></details> : null}
    </div>

    <Dialog open={confirmPublish} onOpenChange={(open) => { if (!pending) setConfirmPublish(open); }}><DialogContent><DialogHeader><DialogTitle>Publish company enrichment now?</DialogTitle><DialogDescription>Submitting makes this company information, all role profiles and their interview rounds public immediately. There is no later approval step. Confirm that you have verified all content and sources.</DialogDescription></DialogHeader>{write.error ? <p role="alert" className="text-sm text-destructive">{conflict ? "Draft revision conflict. Close this dialog to reconcile your preserved edits." : message(write.error)}</p> : null}<DialogFooter><Button variant="ghost" disabled={pending} onClick={() => setConfirmPublish(false)}>Keep editing</Button><Button disabled={pending || conflict} onClick={() => { setNotice(null); write.mutate(true); }}>{write.isPending ? "Publishing…" : "Confirm & publish immediately"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={confirmReload} onOpenChange={(open) => { if (!pending) setConfirmReload(open); }}><DialogContent><DialogHeader><DialogTitle>Replace editor with the latest saved draft?</DialogTitle><DialogDescription>This discards your local unsaved changes. Download your edits first so you can reconcile them with the latest version.</DialogDescription></DialogHeader>{reload.error ? <p role="alert">{message(reload.error)}</p> : null}<DialogFooter><Button variant="ghost" disabled={pending} onClick={() => setConfirmReload(false)}>Keep my edits</Button><Button disabled={pending} onClick={() => reload.mutate()}>{reload.isPending ? "Loading…" : "Discard local edits & load latest"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={confirmPrefill} onOpenChange={(open) => { if (!pending) setConfirmPrefill(open); }}><DialogContent><DialogHeader><DialogTitle>Fill missing fields from research?</DialogTitle><DialogDescription>This fills blanks in unverified sections and adds newly researched roles with sources. Existing content and verified sections are preserved. Added research remains unverified for your review. The draft is saved privately; nothing is published.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" disabled={pending} onClick={() => setConfirmPrefill(false)}>Keep editing</Button><Button disabled={pending || dirty || conflict} onClick={() => { if (pending || dirty || conflict || prefillInFlight.current) return; prefillInFlight.current = true; setNotice(null); prefill.mutate(); }}>{prefill.isPending ? "Filling…" : "Confirm & fill missing fields"}</Button></DialogFooter></DialogContent></Dialog>
    {researchOpen && company ? <DraftReviewDialog company={company} open onOpenChange={setResearchOpen} readOnly /> : null}
  </div>;
}
