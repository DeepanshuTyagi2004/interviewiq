import { randomUUID } from "node:crypto";
import type { CandidateProfileDoc } from "../db/mongo/client.js";
import type { CandidateProfileResponse } from "../domain/candidateProfile.js";
import { EMPTY_LINKS } from "../domain/candidateProfile.js";
import { confirmSchema, extractionSchema, importedStatus, safeLinkedInUrl, type LinkedInCareerProfile, type LinkedInConfirmResponse, type LinkedInExtraction, type LinkedInImportDraft, type LinkedInImportSection, type LinkedInImportStatus, type LinkedInProvenance } from "../domain/linkedinImport.js";
import type { AiServiceClient } from "../integrations/aiService/client.js";
import { canonicalize, sha256Hex } from "../lib/canonicalJson.js";
import { ApiError } from "../lib/errors.js";
import { UpstreamError, UpstreamHttpError } from "../lib/http.js";
import { isObject } from "../lib/json.js";
import type { LinkedInImportRepository } from "../repositories/linkedinImports.js";
import type { ValidationControlsRepository } from "../repositories/validationControls.js";
import type { CandidateProfileRepository, ProfileFragmentRepository } from "../repositories/mongo.js";
import type { UserRepository } from "../repositories/pg.js";
import { toResponse } from "./candidateProfileService.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DERIVED = 512 * 1024;
export const profileRevision = (doc: CandidateProfileDoc | null): string | null => doc ? sha256Hex(canonicalize(doc)) : null;
const conflict = () => new ApiError(409, "linkedin_profile_changed", "Your profile changed after this preview. Upload the PDF again before merging.");
type PdfExtraction = Omit<LinkedInExtraction, "sections" | "provenance"> & { sections: LinkedInImportSection[]; provenance: LinkedInProvenance[] };

/** ai-service PDF rejections the candidate can act on; anything else is a 503. Messages stay API-owned. */
const UPSTREAM_PDF_ERRORS: Record<string, { status: number; message: string }> = {
  linkedin_pdf_unrecognized: { status: 422, message: "This doesn't look like LinkedIn's Save to PDF file. Download it from your LinkedIn profile and upload that file; a resume belongs in the Resume source." },
  linkedin_pdf_unreadable: { status: 422, message: "We couldn't read text from this PDF. Download it again with LinkedIn's Save to PDF and upload that file." },
  linkedin_pdf_no_claims: { status: 422, message: "No career details could be read from this PDF. Check it is LinkedIn's Save to PDF file, or add details manually on your profile." },
  linkedin_pdf_too_large: { status: 413, message: "The LinkedIn PDF must be 5 MB or smaller." },
};

function upstreamCode(err: UpstreamHttpError): string | null {
  try {
    const body: unknown = JSON.parse(err.responseBody);
    const detail = isObject(body) && isObject(body.detail) ? body.detail : null;
    return typeof detail?.code === "string" ? detail.code : null;
  } catch { return null; }
}

/** Display-only receipt of which file the claims came from; never a path, never trusted. */
export function sourceFileName(filename: string | null): string {
  const name = (filename ?? "").replace(/[\x00-\x1f\x7f/\\]/g, "").trim().slice(-120);
  return name || "LinkedIn.pdf";
}

const normalize = (value: unknown): string => typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") : "";

export function careerDraft(profile: LinkedInCareerProfile): CandidateProfileResponse {
  return { level: null, fullName: null, email: null, phone: null, location: null,
    headline: profile.headline, targetRole: null, targetJdId: null, education: profile.education,
    experience: profile.experience, projects: profile.projects, skills: profile.skills, achievements: profile.achievements,
    detectedLinks: { ...EMPTY_LINKS }, resumeFilename: null, resumeParsedAt: null, onboardingComplete: false };
}

function uniqueStrings(old: string[], additions: string[]): string[] {
  const found = new Set(old.map(normalize));
  return [...old, ...additions.filter((value) => { const key = normalize(value); if (!key || found.has(key)) return false; found.add(key); return true; })];
}

/** Fill blank scalar fields; add rows/claims without replacing non-empty human edits. */
export function mergeCareer(existing: CandidateProfileDoc | null, selected: Partial<LinkedInCareerProfile>, warnings: string[]): Partial<CandidateProfileDoc> {
  const base = existing ?? { ...careerDraft({ headline: null, about: null, experience: [], education: [], projects: [], skills: [], achievements: [] }), userId: "" };
  const patch: Partial<CandidateProfileDoc> = existing ? {} : {
    level: null, fullName: null, email: null, phone: null, location: null, headline: null, targetRole: null, targetJdId: null,
    education: [], experience: [], projects: [], skills: [], achievements: [], detectedLinks: { ...EMPTY_LINKS }, resumeFilename: null, resumeParsedAt: null,
  };
  if (selected.headline && !normalize(base.headline)) patch.headline = selected.headline;
  for (const key of ["skills", "achievements"] as const) if (selected[key]) patch[key] = uniqueStrings(base[key], selected[key]);
  for (const key of ["education", "projects"] as const) {
    if (!selected[key]) continue;
    const old = base[key];
    const identity = (row: unknown): string => {
      const r = row as Record<string, unknown>;
      return key === "education" ? [r.institution, r.degree, r.field].map(normalize).join("|") : normalize(r.name);
    };
    const seen = new Set(old.map(identity));
    const additions = selected[key].filter((row) => { const id = identity(row); if (!id.replace(/\|/g, "") || seen.has(id)) return false; seen.add(id); return true; });
    if (key === "education") patch.education = [...base.education, ...(additions as LinkedInCareerProfile["education"])];
    else patch.projects = [...base.projects, ...(additions as LinkedInCareerProfile["projects"])];
  }
  if (selected.experience) {
    const rows = [...base.experience];
    for (const incoming of selected.experience) {
      const identity = (r: typeof incoming) => [r.company, r.title].map(normalize).join("|");
      const id = identity(incoming);
      if (!id.replace(/\|/g, "")) continue;
      const index = rows.findIndex((r) => identity(r) === id);
      if (index < 0) { rows.push(incoming); continue; }
      const old = rows[index]!;
      if ((normalize(old.startDate) && normalize(incoming.startDate) && normalize(old.startDate) !== normalize(incoming.startDate)) ||
          (normalize(old.endDate) && normalize(incoming.endDate) && normalize(old.endDate) !== normalize(incoming.endDate))) {
        warnings.push("An imported role has conflicting dates for an existing company/title. The existing role was preserved and the imported row was skipped.");
        continue;
      }
      rows[index] = { ...old,
        startDate: normalize(old.startDate) ? old.startDate : incoming.startDate,
        endDate: normalize(old.endDate) ? old.endDate : incoming.endDate,
        location: normalize(old.location) ? old.location : incoming.location,
        bullets: uniqueStrings(old.bullets ?? [], incoming.bullets ?? []) };
    }
    patch.experience = rows;
  }
  return patch;
}

export class LinkedInImportService {
  constructor(private readonly drafts: LinkedInImportRepository, private readonly profiles: CandidateProfileRepository,
    private readonly fragments: ProfileFragmentRepository, private readonly users: UserRepository, private readonly ai: AiServiceClient,
    private readonly validationControls: ValidationControlsRepository) {}

  async status(userId: string): Promise<LinkedInImportStatus> {
    return importedStatus((await this.fragments.findByUserIdAndSource(userId, "LINKEDIN"))?.data);
  }

  /** One consented LinkedIn "Save to PDF" upload -> private 24-hour review draft. The PDF is never stored. */
  async create(userId: string, upload: { bytes: Buffer; filename: string | null }): Promise<LinkedInImportDraft> {
    const controls = await this.validationControls.settings();
    if (!controls.linkedinImportEnabled) throw new ApiError(503, "linkedin_import_disabled", "LinkedIn import is currently disabled by an administrator.");
    if (!await this.users.findById(userId)) throw new ApiError(404, "user_not_found", "Your account no longer exists.");
    const before = await this.profiles.findByUserId(userId);
    const epoch = await this.drafts.withUserLock(userId, async () => {
      if (!await this.users.findById(userId)) throw new ApiError(404, "user_not_found", "Your account no longer exists.");
      await this.drafts.checkCapacity(userId);
      return this.drafts.epoch(userId);
    });
    let raw: unknown;
    try { raw = await this.ai.parseLinkedInPdf(upload.bytes); }
    catch (err) {
      const code = err instanceof UpstreamHttpError ? upstreamCode(err) : null;
      const known = code ? UPSTREAM_PDF_ERRORS[code] : undefined;
      if (code && known) throw new ApiError(known.status, code, known.message);
      if (err instanceof UpstreamError) throw new ApiError(503, "linkedin_extractor_unavailable", "Your PDF could not be read right now. Try again in a minute.");
      throw err;
    }
    const data = this.parseExtraction(raw, sourceFileName(upload.filename));
    if (!data) throw new ApiError(503, "linkedin_extractor_unavailable", "The profile extractor returned an unsupported result. Try again in a minute.");
    return this.drafts.withUserLock(userId, async () => {
      if (!await this.users.findById(userId)) throw new ApiError(404, "user_not_found", "Your account no longer exists.");
      if (!await this.drafts.matchesEpoch(userId, epoch)) throw new ApiError(409, "linkedin_import_cancelled", "This import was cancelled because LinkedIn was disconnected. Upload the PDF again.");
      return this.saveDraft(userId, before, data);
    });
  }

  /** Strict ai-service result, bound to the uploaded file. Inconsistent evidence is rejected, not repaired. */
  private parseExtraction(raw: unknown, file: string): PdfExtraction | null {
    const parsed = extractionSchema.safeParse(raw);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > MAX_DERIVED) return null;
    const keys = new Set(parsed.data.sections.map((s) => s.key));
    if (keys.size !== parsed.data.sections.length || parsed.data.provenance.some((p) => !keys.has(p.section))) return null;
    return { ...parsed.data, sourceUrl: safeLinkedInUrl(parsed.data.sourceUrl),
      sections: parsed.data.sections.map((section) => ({ ...section, sourceFile: file })),
      provenance: parsed.data.provenance.map((item) => ({ ...item, file })) };
  }

  private async saveDraft(userId: string, before: CandidateProfileDoc | null, data: PdfExtraction): Promise<LinkedInImportDraft> {
    const now = new Date(), expiresAt = new Date(now.getTime() + TTL_MS);
    const draft: LinkedInImportDraft = { id: randomUUID(), createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
      method: "pdf", profileRevision: profileRevision(before), profile: careerDraft(data.profile), sections: data.sections,
      warnings: data.warnings, sourceUrl: data.sourceUrl, provider: null, retrievedAt: null };
    await this.drafts.insert({ _id: draft.id, userId, draft, sourceProfile: data.profile, provenance: data.provenance, expiresAt });
    return draft;
  }

  async confirm(userId: string, id: string, body: unknown): Promise<LinkedInConfirmResponse> {
    // requireSectionReview is stored for a future product decision. It never opts users into
    // automatic source publication: explicit non-empty section review remains mandatory.
    const request = confirmSchema.safeParse(body);
    if (!request.success) throw new ApiError(400, "linkedin_confirm_invalid", "Select one or more available career sections and an optional boolean mergeProfile.");
    const selectedKeys = [...new Set(request.data.sections)].sort(), mergeProfile = request.data.mergeProfile;
    return this.drafts.withUserLock(userId, async () => {
      const doc = await this.drafts.find(id, userId);
      if (!doc) throw new ApiError(404, "linkedin_import_not_found", "This import draft was not found.");
      if (doc.expiresAt.getTime() <= Date.now()) throw new ApiError(410, "linkedin_import_expired", "This preview expired after 24 hours. Upload the PDF again.");
      if (!await this.users.findById(userId)) throw new ApiError(404, "user_not_found", "Your account no longer exists.");
      if (selectedKeys.some((key) => !doc.draft.sections.some((s) => s.key === key))) throw new ApiError(400, "linkedin_confirm_invalid", "A selected section was not present in this preview.");
      if (doc.selection && (canonicalize(doc.selection) !== canonicalize(selectedKeys) || doc.mergeProfile !== mergeProfile)) {
        throw new ApiError(409, "linkedin_import_already_confirmed", "This draft already has a different confirmation. Upload the PDF again to change your selection.");
      }
      if (doc.receipt) return doc.receipt;
      const importedAt = doc.importedAt ?? new Date().toISOString();
      await this.drafts.patch(id, userId, { selection: selectedKeys, mergeProfile, importedAt });
      const profile: Partial<LinkedInCareerProfile> = {};
      for (const key of selectedKeys) if (Object.hasOwn(doc.sourceProfile, key)) {
        Object.assign(profile, { [key]: doc.sourceProfile[key as keyof LinkedInCareerProfile] });
      }
      const warnings = [...(doc.confirmWarnings ?? doc.draft.warnings)];
      let resultProfile: CandidateProfileResponse | null = null;
      if (mergeProfile) {
        const existing = await this.profiles.findByUserId(userId), revision = `${id}:merged`;
        if (doc.mergedRevision) {
          resultProfile = doc.mergedProfile ?? null;
        } else if (existing?.revision === revision) {
          resultProfile = toResponse(existing, (await this.users.findById(userId))?.onboardingComplete ?? false);
        } else {
          if (profileRevision(existing) !== doc.draft.profileRevision) throw conflict();
          const patch = mergeCareer(existing, profile, warnings);
          const saved = existing && Object.keys(patch).length === 0 ? existing : await this.profiles.compareAndSet(existing, userId, patch, revision);
          if (!saved) throw conflict();
          resultProfile = toResponse(saved, (await this.users.findById(userId))?.onboardingComplete ?? false);
        }
        await this.drafts.patch(id, userId, { mergedRevision: revision, mergedProfile: resultProfile, confirmWarnings: warnings });
      }
      const data = { importMethod: doc.draft.method, importedAt, partial: true, profile,
        sourceUrl: doc.draft.sourceUrl, provider: doc.draft.provider, retrievedAt: doc.draft.retrievedAt,
        sections: doc.draft.sections.filter((s) => selectedKeys.includes(s.key)),
        provenance: doc.provenance.filter((p) => selectedKeys.includes(p.section)), warnings: [...new Set(warnings)] };
      const hash = sha256Hex(canonicalize(data));
      const previous = await this.fragments.findByUserIdAndSource(userId, "LINKEDIN");
      if (previous?.contentHash !== hash) await this.fragments.upsert(userId, "LINKEDIN", data, hash, new Date(importedAt));
      const receipt: LinkedInConfirmResponse = { profile: resultProfile, import: importedStatus(data) };
      await this.drafts.patch(id, userId, { receipt });
      return receipt;
    });
  }

  async disconnect(userId: string): Promise<void> {
    await this.drafts.withUserLock(userId, async () => {
      await this.fragments.deleteByUserIdAndSource(userId, "LINKEDIN");
      await this.drafts.deleteByUserId(userId);
    });
  }
}
