"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { previewLinkedInMerge } from "@/features/linkedin/merge-preview";
import { isSupportedSection, LINKEDIN_SECTION_KEYS, type LinkedInImportDraft } from "@/features/linkedin/types";
import type { CandidateProfileResponse } from "@/features/onboarding/types";
import { canonicalLinkedInUrl } from "@/features/linkedin/url";
import { linkedInSourceLabel } from "@/features/linkedin/provider";

export function LinkedInReview({ draft, selected, onSelected, mergeProfile, onMergeProfile, current, profileReady, disabled }: {
  draft: LinkedInImportDraft;
  selected: string[];
  onSelected: (sections: string[]) => void;
  mergeProfile: boolean;
  onMergeProfile: (merge: boolean) => void;
  current: CandidateProfileResponse | null;
  profileReady: boolean;
  disabled: boolean;
}) {
  const id = useId();
  const supported = draft.sections.filter((section) => isSupportedSection(section.key) && section.entries.length > 0);
  const missing = LINKEDIN_SECTION_KEYS.filter((key) => !supported.some((section) => section.key === key));
  const unsupported = draft.sections.filter((section) => !isSupportedSection(section.key));
  const preview = previewLinkedInMerge(current, draft.profile, supported.filter((section) => selected.includes(section.key)));
  const sourceUrl = canonicalLinkedInUrl(draft.sourceUrl);
  const pdf = draft.method === "pdf";
  const sourceFile = draft.sections.find((section) => section.sourceFile)?.sourceFile ?? null;
  const at = pdf ? draft.createdAt : draft.retrievedAt;
  const when = at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString() : "Not available";
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">Review before saving. Only checked sections will become LinkedIn source evidence. This is a one-time import, not a live connection.</p>
      <p className="text-muted-foreground">Imported claims are self-reported, not independently verified. Job titles and company prestige do not verify career accomplishments or technical ability. Sparse or missing evidence is not proof of missing ability. Your engineering level is never inferred or changed.</p>
      <div className="space-y-1 rounded-[16px] bg-surface p-3 text-xs text-muted-foreground"><p className="break-all">Source: {linkedInSourceLabel(draft)}{sourceFile ? ` (${sourceFile})` : ""} · self-reported, not independent verification</p>{sourceUrl ? <p>Profile link {pdf ? "in the PDF" : "retrieved"}: <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-foreground underline underline-offset-4">{sourceUrl} (opens in a new tab)</a></p> : null}<p>{pdf ? "Uploaded" : "Retrieved"}: {when}</p><p>One-time snapshot, not live synced. Missing sections are unavailable evidence and will not be invented.</p></div>
      <p className="text-xs text-muted-foreground">Draft expires {new Date(draft.expiresAt).toLocaleString()}.</p>
      {draft.warnings.length > 0 ? <div role="status" className="rounded-[16px] bg-surface p-3"><h3 className="font-medium">Import warnings</h3><ul className="mt-1 list-disc space-y-1 pl-5">{draft.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div> : null}
      <p className="text-xs text-muted-foreground">Missing sections: {missing.length ? missing.join(", ") : "none"}. Missing sections will not be added.</p>
      {unsupported.length > 0 ? <p role="status" className="text-muted-foreground">Unsupported sections skipped: {unsupported.map((section) => section.label).join(", ")}.</p> : null}
      {supported.length === 0 ? <p role="alert">No supported sections were found in this PDF. Check it&rsquo;s the file from LinkedIn&rsquo;s Save to PDF, then upload it again.</p> : null}
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="mb-2 font-medium">Choose sections to import</legend>
        {supported.map((section, index) => (
          <div key={section.key} className="rounded-[16px] bg-surface p-3">
            <div className="flex items-center gap-2"><Checkbox id={`${id}-${index}`} disabled={disabled} checked={selected.includes(section.key)} onCheckedChange={(checked) => onSelected(checked === true ? [...selected, section.key] : selected.filter((key) => key !== section.key))} /><label className="font-medium" htmlFor={`${id}-${index}`}>{section.label}</label></div>
            <ul className="mt-2 list-disc space-y-1 whitespace-pre-wrap break-words pl-5">{section.entries.map((entry, i) => <li key={i}>{entry}</li>)}</ul>
          </div>
        ))}
      </fieldset>
      <div className="rounded-[16px] bg-surface p-3">
        <div className="flex items-start gap-2"><Checkbox id={`${id}-merge`} checked={mergeProfile} disabled={disabled || !profileReady} onCheckedChange={(checked) => onMergeProfile(checked === true)} /><label htmlFor={`${id}-merge`}>Also merge selected sections into my editable profile</label></div>
        <p className="mt-2 text-xs text-muted-foreground">Off by default: save source evidence only; your editable profile stays unchanged. Existing non-empty values are never overwritten. Blank fields may be filled and new rows or role bullets appended after deduplication. Conflicting role dates keep the existing row and skip the imported row.</p>
        {!profileReady ? <p role="status" className="mt-2 text-xs">Your current profile could not be loaded yet. Source-only import is available; wait or re-import before merging.</p> : null}
      </div>
      {mergeProfile && profileReady ? (
        <section aria-label="Profile merge preview" className="space-y-3 rounded-[16px] bg-surface p-3">
          <h3 className="font-medium">Profile merge preview</h3>
          <p className="text-xs text-muted-foreground">Keep current engineering level: {current?.level ?? "not selected"}. Name, contact details, target role and existing headline are preserved. The server rechecks your profile revision before saving.</p>
          {preview.map((section) => <div key={section.key} className="space-y-1"><h4 className="font-medium">{section.label}</h4><p className="text-xs">Existing (keep): {section.existing.join("; ") || "none"}</p><p className="text-xs">Append / fill blank: {section.append.join("; ") || "none"}</p>{section.notes.map((note, i) => <p key={i} className="text-xs text-muted-foreground">{note}</p>)}</div>)}
        </section>
      ) : null}
    </div>
  );
}
