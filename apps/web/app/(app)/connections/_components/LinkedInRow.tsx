"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MonoPill } from "@/components/patterns";
import { cn } from "@/lib/utils/cn";
import { useCandidateProfile } from "@/features/onboarding";
import { ONBOARDING_QUERY_KEYS } from "@/lib/constants/onboarding";
import { PROFILE_QUERY_KEYS } from "@/lib/constants/profile";
import { SCORE_KEYS } from "@/features/profile-scoring/constants";
import { ApiFetchError } from "@/lib/api-client/client";
import { confirmLinkedIn, importLinkedInPdf, getLinkedInStatus, LINKEDIN_STATUS_KEY, removeLinkedIn } from "@/features/linkedin/api";
import { canonicalLinkedInUrl } from "@/features/linkedin/url";
import { linkedInSourceLabel } from "@/features/linkedin/provider";
import { linkedInError } from "@/features/linkedin/errors";
import { isSupportedSection, LINKEDIN_PDF_MAX_BYTES, type LinkedInImportDraft } from "@/features/linkedin/types";
import { LinkedInPdfSteps } from "./LinkedInPdfSteps";
import { LinkedInReview } from "./LinkedInReview";
import { SourceRow, type SourceRowVariant } from "./SourceRow";
import { sourceDate } from "./format";
import type { ProviderMeta } from "./providers";

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LinkedInRow({ provider, variant = "stack", resumeLinkedInUrl }: { provider: ProviderMeta; variant?: SourceRowVariant; resumeLinkedInUrl?: string | null }) {
  const client = useQueryClient();
  const status = useQuery({ queryKey: LINKEDIN_STATUS_KEY, queryFn: getLinkedInStatus, retry: false });
  const candidate = useCandidateProfile();
  const [open, setOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState<LinkedInImportDraft | null>(null);
  const [invalidDraft, setInvalidDraft] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeProfile, setMergeProfile] = useState(false);
  const [pending, setPending] = useState<"upload" | "confirm" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  // Only used to deep-link step 1; the import itself never fetches this URL.
  const profileUrl = canonicalLinkedInUrl(resumeLinkedInUrl ?? candidate.data?.detectedLinks.linkedin) ?? canonicalLinkedInUrl(status.data?.sourceUrl);

  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  useEffect(() => {
    if (!draft) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [draft]);

  function invalidate() {
    void client.invalidateQueries({ queryKey: LINKEDIN_STATUS_KEY });
    void client.invalidateQueries({ queryKey: PROFILE_QUERY_KEYS.profile });
    void client.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEYS.candidateProfile });
    void client.invalidateQueries({ queryKey: SCORE_KEYS.all });
    void client.invalidateQueries({ queryKey: ["auth", "me"] });
  }

  function reset() {
    setDraft(null); setInvalidDraft(false); setSelected([]); setMergeProfile(false); setError(null); setConsent(false); setFile(null);
  }

  function changeOpen(value: boolean) {
    generation.current++;
    if (!value) {
      request.current?.abort();
      request.current = null;
      if (pending === "upload") { busy.current = false; setPending(null); }
      reset();
    }
    setOpen(value);
  }

  function choose(candidateFile: File | undefined) {
    if (!candidateFile || pending !== null) return;
    if (candidateFile.type !== "application/pdf" && !candidateFile.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose the PDF file you downloaded with LinkedIn's Save to PDF."); return;
    }
    if (candidateFile.size > LINKEDIN_PDF_MAX_BYTES) { setError("The PDF must be 5 MB or smaller. LinkedIn's Save to PDF file is usually well under 1 MB."); return; }
    setError(null); setFile(candidateFile);
  }

  async function upload() {
    if (busy.current || !consent || !file) return;
    busy.current = true;
    const current = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setError(null); setPending("upload");
    try {
      const result = await importLinkedInPdf(file, controller.signal);
      if (current !== generation.current) return;
      setNow(Date.now()); setDraft(result); setMergeProfile(false);
      setSelected(result.sections.filter((section) => isSupportedSection(section.key) && section.entries.length > 0).map((section) => section.key));
      // Upload returns only a temporary review draft; it never confirms source/profile data.
    } catch (failure) {
      if (current === generation.current) setError(linkedInError(failure));
    } finally {
      if (current === generation.current) { busy.current = false; setPending(null); request.current = null; }
    }
  }

  const expired = Boolean(draft && Date.parse(draft.expiresAt) <= now);
  async function confirm() {
    if (!draft || expired || invalidDraft || busy.current || selected.length === 0 || (mergeProfile && !candidate.isSuccess)) return;
    busy.current = true;
    const current = generation.current;
    setPending("confirm"); setError(null);
    try {
      const result = await confirmLinkedIn(draft.id, selected, mergeProfile);
      client.setQueryData(LINKEDIN_STATUS_KEY, result.import);
      invalidate();
      toast.success("LinkedIn sections imported. Assessment freshness updated.");
      if (current === generation.current) { reset(); setOpen(false); }
    } catch (failure) {
      // A dismissed dialog must not reopen or accept an out-of-order response.
      invalidate();
      if (current === generation.current) {
        setError(linkedInError(failure));
        if (failure instanceof ApiFetchError && (failure.status === 404 || failure.status === 410 || (failure.status === 409 && failure.code !== "linkedin_import_busy"))) setInvalidDraft(true);
      }
      else toast.error(linkedInError(failure));
    } finally {
      busy.current = false; setPending(null);
    }
  }

  async function remove() {
    if (busy.current) return;
    busy.current = true; setPending("remove"); setRemoveError(null);
    try {
      await removeLinkedIn();
      invalidate(); setRemoveOpen(false);
      toast.success("LinkedIn source removed. Merged profile details are preserved.");
    } catch (failure) { setRemoveError(linkedInError(failure)); invalidate(); }
    finally { busy.current = false; setPending(null); }
  }

  const connected = status.data?.connected ?? false;
  const pdf = status.data?.method === "pdf";
  const snapshotAt = pdf ? status.data?.importedAt : status.data?.retrievedAt;
  return (
    <>
      <SourceRow variant={variant} code={provider.code} name={provider.label} connected={connected}
        state={status.isError ? "error" : connected ? "active" : "idle"} stateLabel={connected ? "Snapshot imported, not live synced" : status.isError ? "Snapshot status unavailable" : "No snapshot imported"}
        pill={connected ? <MonoPill tone="soft">{pdf ? "PDF snapshot" : "Public snapshot"}</MonoPill> : null}
        detail={connected ? `${linkedInSourceLabel(status.data)} snapshot · Not live synced${snapshotAt ? ` · ${pdf ? "imported" : "retrieved"} ${sourceDate(snapshotAt)}` : ""}` : provider.description}
        actions={<><Button type="button" variant={connected ? "strong" : "ink"} size="sm" className="min-w-[96px]" disabled={pending !== null} onClick={() => { reset(); changeOpen(true); }} aria-label={connected ? "Replace LinkedIn snapshot" : "Import LinkedIn"}>{connected ? "Replace snapshot" : "Import"}</Button>{connected ? <Button type="button" variant="ghost" size="sm" disabled={pending !== null} onClick={() => { setRemoveError(null); setRemoveOpen(true); }} aria-label="Remove LinkedIn source">Remove</Button> : null}</>}
      >
        {status.isError ? <p role="alert" className="text-sm text-muted-foreground">Could not load LinkedIn import status. <Button type="button" variant="ghost" size="sm" onClick={() => void status.refetch()}>Check status</Button></p> : null}
        {connected && status.data?.warnings.length ? <p className="text-xs text-muted-foreground">Imported with warnings: {status.data.warnings.join(" ")}</p> : null}
      </SourceRow>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{draft ? "Review LinkedIn import" : "Import LinkedIn profile"}</DialogTitle><DialogDescription>{draft ? "Choose the professional sections you want to keep." : "Upload the PDF LinkedIn makes of your profile, then review what we found. Nothing is fetched from LinkedIn."}</DialogDescription></DialogHeader>
          {draft ? <LinkedInReview draft={draft} selected={selected} onSelected={setSelected} mergeProfile={mergeProfile} onMergeProfile={setMergeProfile} current={candidate.data ?? null} profileReady={candidate.isSuccess} disabled={pending !== null || expired || invalidDraft} /> : (
            <div className="space-y-4 text-sm">
              <LinkedInPdfSteps profileUrl={profileUrl} />
              <div
                role="button"
                tabIndex={0}
                aria-disabled={pending !== null}
                aria-describedby={`${id}-file-hint`}
                onClick={() => pending === null && inputRef.current?.click()}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && pending === null) { event.preventDefault(); inputRef.current?.click(); }
                }}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]); }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-4 bg-card p-5 text-center transition-colors duration-200 hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  (dragging || file) && "border-faint-2",
                  dragging && "bg-accent",
                  pending !== null && "pointer-events-none opacity-70",
                )}
              >
                <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-primary text-primary-foreground">
                  {file ? <FileText className="h-5 w-5" /> : <UploadCloud className="h-5 w-5" />}
                </span>
                <p className="m-0 break-all text-sm">{file ? file.name : "Drop your LinkedIn PDF here, or click to choose"}</p>
                <p id={`${id}-file-hint`} className="m-0 text-[13px] text-faint">{file ? `${fileSize(file.size)} · click to choose a different file` : "PDF only, up to 5 MB"}</p>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="LinkedIn PDF file" disabled={pending !== null}
                  onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} />
              </div>
              <div className="flex items-start gap-2"><Checkbox id={`${id}-consent`} checked={consent} disabled={pending !== null} onCheckedChange={(checked) => setConsent(checked === true)} /><label htmlFor={`${id}-consent`}>This is my own LinkedIn profile. I consent to the configured AI service reading this PDF to prepare a reviewable draft, and to importing only the sections I confirm.</label></div>
              <p className="text-xs text-muted-foreground">The PDF is read once and not stored. Nothing is added to your sources or editable profile until you confirm selected sections. This is a one-time snapshot, not a live connection.</p>
            </div>
          )}
          {expired ? <p role="alert" className="text-sm text-destructive">This draft expired. Upload the PDF again to review a fresh draft.</p> : null}
          {error ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{draft ? <Button type="button" variant="ghost" size="sm" disabled={pending !== null || status.isFetching} onClick={() => void status.refetch()}>Check saved source status</Button> : null}</div> : null}
          {pending ? <p role="status" className="text-sm text-muted-foreground">{pending === "upload" ? "Reading your PDF and preparing a review draft… This can take up to a minute. You can cancel." : "Saving selected sections… Closing this dialog does not undo a submitted confirmation; check the source status."}</p> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => changeOpen(false)}>Cancel</Button>
            {draft ? <><Button type="button" variant="ghost" disabled={pending !== null} onClick={reset}>Upload a different PDF</Button><Button type="button" variant="ink" disabled={pending !== null || expired || invalidDraft || selected.length === 0 || (mergeProfile && !candidate.isSuccess)} onClick={() => void confirm()}>{pending === "confirm" ? "Saving…" : "Confirm selected sections"}</Button></> : <Button type="button" variant="ink" disabled={!consent || !file || pending !== null} onClick={() => void upload()}>{pending === "upload" ? "Reading…" : "Read PDF"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={removeOpen} onOpenChange={(value) => { if (pending !== "remove") setRemoveOpen(value); }}>
        <DialogContent><DialogHeader><DialogTitle>Remove LinkedIn source?</DialogTitle><DialogDescription>The imported LinkedIn source evidence will be removed. Details already merged into your editable profile remain there and can be edited on Profile. Assessment freshness will update; this does not start recalculation.</DialogDescription></DialogHeader>{removeError ? <p role="alert" className="text-sm text-destructive">{removeError}</p> : null}<DialogFooter className="gap-2"><Button type="button" variant="ghost" disabled={pending !== null} onClick={() => setRemoveOpen(false)}>Cancel</Button><Button type="button" variant="destructive" disabled={pending !== null} onClick={() => void remove()}>{pending === "remove" ? "Removing…" : "Remove source"}</Button></DialogFooter></DialogContent>
      </Dialog>
    </>
  );
}
