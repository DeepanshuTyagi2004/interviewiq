import type { CandidateProfileResponse } from "@/features/onboarding/types";
import type { LinkedInImportSection } from "./types";

export interface MergePreview {
  key: string;
  label: string;
  existing: string[];
  append: string[];
  notes: string[];
}
const norm = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const line = (values: (string | null | undefined)[]) => values.filter(Boolean).join(" · ");
const identity = (values: (string | null | undefined)[]) => values.map(norm).join("|");
interface PreviewRow {
  identity: string;
  label: string;
  text: string;
  start?: string | null;
  end?: string | null;
  location?: string | null;
  bullets?: string[] | null;
}
function profileRows(profile: CandidateProfileResponse | null, key: "experience" | "education" | "projects"): PreviewRow[] {
  if (key === "experience") return (profile?.experience ?? []).map((x) => ({
    identity: identity([x.company, x.title]), label: line([x.company, x.title]),
    text: line([x.title, x.company, x.startDate, x.endDate, x.location, ...(x.bullets ?? [])]),
    start: x.startDate, end: x.endDate, location: x.location, bullets: x.bullets,
  }));
  if (key === "education") return (profile?.education ?? []).map((x) => ({
    identity: identity([x.institution, x.degree, x.field]), label: line([x.institution, x.degree, x.field]),
    text: line([x.institution, x.degree, x.field, x.startYear, x.endYear, x.grade]), start: x.startYear, end: x.endYear,
  }));
  return (profile?.projects ?? []).map((x) => ({
    identity: norm(x.name), label: x.name ?? "", text: line([x.name, x.description, ...(x.tech ?? []), ...(x.bullets ?? []), x.link]),
  }));
}

/** Read-only preview. Only the confirmation endpoint performs an authoritative merge. */
export function previewLinkedInMerge(
  current: CandidateProfileResponse | null,
  incoming: CandidateProfileResponse,
  sections: LinkedInImportSection[],
): MergePreview[] {
  return sections.map((section) => {
    const preview: MergePreview = { key: section.key, label: section.label, existing: [], append: [], notes: [] };
    if (section.key === "headline") {
      preview.existing = current?.headline ? [current.headline] : [];
      preview.append = !current?.headline?.trim() && incoming.headline ? [incoming.headline] : [];
      if (current?.headline?.trim()) preview.notes.push("Keep existing headline; the imported headline will not overwrite it.");
    } else if (section.key === "skills" || section.key === "achievements") {
      preview.existing = current?.[section.key] ?? [];
      const seen = new Set(preview.existing.map(norm));
      for (const item of incoming[section.key] ?? []) {
        if (norm(item) && !seen.has(norm(item))) { preview.append.push(item); seen.add(norm(item)); }
      }
      preview.notes.push("Exact normalized duplicates are skipped.");
    } else if (section.key === "experience" || section.key === "education" || section.key === "projects") {
      const key = section.key;
      const items = profileRows(incoming, key);
      const existing = profileRows(current, key);
      preview.existing = existing.map((x) => x.text);
      const seen = new Map<string, PreviewRow>();
      for (const row of existing) if (!seen.has(row.identity)) seen.set(row.identity, row);
      for (const item of items) {
        if (!item.identity.replace(/\|/g, "")) { preview.notes.push("An unnamed row has no stable identity and will be skipped."); continue; }
        const match = seen.get(item.identity);
        if (match) {
          const datesConflict = (norm(match.start) && norm(item.start) && norm(match.start) !== norm(item.start)) || (norm(match.end) && norm(item.end) && norm(match.end) !== norm(item.end));
          if (datesConflict) {
            preview.notes.push(`Possible date conflict for ${item.label}: existing ${line([match.start, match.end])}; imported ${line([item.start, item.end])}. Existing row stays unchanged; imported row is skipped.`);
            continue;
          }
          if (key !== "experience") { preview.notes.push(`Duplicate ${item.label}: existing row stays unchanged.`); continue; }
          const additions: string[] = [];
          if (!norm(match.start) && item.start) additions.push(`fill blank start date: ${item.start}`);
          if (!norm(match.end) && item.end) additions.push(`fill blank end date: ${item.end}`);
          if (!norm(match.location) && item.location) additions.push(`fill blank location: ${item.location}`);
          const bullets = new Set((match.bullets ?? []).map(norm));
          const newBullets = (item.bullets ?? []).filter((bullet) => { const value = norm(bullet); if (!value || bullets.has(value)) return false; bullets.add(value); return true; });
          if (newBullets.length) additions.push(`append new bullets: ${newBullets.join("; ")}`);
          if (additions.length) preview.append.push(`${item.label} — ${additions.join("; ")}`);
          else preview.notes.push(`Duplicate ${item.label}: no new values to append.`);
          seen.set(item.identity, { ...match, start: norm(match.start) ? match.start : item.start, end: norm(match.end) ? match.end : item.end, location: norm(match.location) ? match.location : item.location, bullets: [...(match.bullets ?? []), ...newBullets] });
        } else if (item.text) { preview.append.push(item.text); seen.set(item.identity, item); }
      }
    } else {
      preview.notes.push("Source evidence only — there is no matching editable profile field for this section.");
    }
    return preview;
  });
}
