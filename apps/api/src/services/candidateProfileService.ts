import type { CandidateProfileDoc } from "../db/mongo/client.js";
import {
  type CandidateProfileResponse,
  draftFromParsedResume,
  EMPTY_LINKS,
  education,
  experience,
  links,
  listOf,
  project,
  str,
  strList,
  safeUrl,
} from "../domain/candidateProfile.js";
import type { AiServiceClient } from "../integrations/aiService/client.js";
import { isUpstreamStatus, parseJsonBody } from "../lib/http.js";
import { BadRequestError } from "../lib/errors.js";
import { asString, isObject, path, trimToNull } from "../lib/json.js";
import type { CandidateProfileRepository } from "../repositories/mongo.js";
import type { UserRepository } from "../repositories/pg.js";
import { engineeringLevelView, isEngineeringLevel, normalizeLegacyLevel, type EngineeringLevel } from "../domain/engineeringLevels.js";

export interface ResumeParseRunResponse {
  status: "running" | "completed" | "failed";
  profile: CandidateProfileResponse | null;
  error: string | null;
}

/** PUT /users/me/candidate-profile body. `complete=true` finishes onboarding. */
export interface CandidateProfileRequest {
  level?: EngineeringLevel | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  portfolioWebsite?: string | null;
  targetRole: string | null;
  targetJdId: string | null;
  education: unknown;
  experience: unknown;
  projects: unknown;
  skills: unknown;
  achievements: unknown;
  detectedLinks: unknown;
  resumeFilename: string | null;
  complete: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `targetJdId` is optional; when present it must look like a JD id. */
function targetJdIdOf(v: unknown): string | null {
  const id = trimToNull(str(v));
  if (id === null) return null;
  if (!UUID_RE.test(id)) throw new BadRequestError("targetJdId must be a JD id (UUID)", "invalid_target_jd");
  return id.toLowerCase();
}

export function parseCandidateProfileRequest(body: unknown): CandidateProfileRequest {
  const b = isObject(body) ? body : {};
  if (Object.hasOwn(b, "level") && b.level !== null && !isEngineeringLevel(b.level)) {
    throw new BadRequestError("Choose a valid engineering level", "invalid_level");
  }
  if (b.complete === true && b.level === null) throw new BadRequestError("Choose an engineering level to finish onboarding", "invalid_level");
  return {
    ...(Object.hasOwn(b, "level") ? { level: b.level as EngineeringLevel | null } : {}),
    fullName: str(b.fullName),
    email: str(b.email),
    phone: str(b.phone),
    location: str(b.location),
    headline: str(b.headline),
    portfolioWebsite: safeUrl(
      Object.hasOwn(b, "portfolioWebsite")
        ? b.portfolioWebsite
        : isObject(b.detectedLinks)
          ? b.detectedLinks.portfolioWebsite ?? b.detectedLinks.portfolio_website
          : null,
    ),
    targetRole: str(b.targetRole),
    targetJdId: targetJdIdOf(b.targetJdId),
    education: b.education,
    experience: b.experience,
    projects: b.projects,
    skills: b.skills,
    achievements: b.achievements,
    detectedLinks: b.detectedLinks,
    resumeFilename: str(b.resumeFilename),
    complete: b.complete === true,
  };
}

/**
 * Onboarding candidate profile: resume parsing (stateless proxy to the AI service), read, and
 * upsert. The profile document lives in MongoDB; the `onboardingComplete` flag stays on the
 * Postgres user row (it gates app entry).
 */
export class CandidateProfileService {
  constructor(
    private readonly profiles: CandidateProfileRepository,
    private readonly users: UserRepository,
    private readonly aiService: AiServiceClient,
    /** Compatibility read for the previous scoring-only choice; never supersedes an owned profile field. */
    private readonly legacyLevel?: (userId: string) => Promise<unknown>,
  ) {}

  private async response(doc: CandidateProfileDoc, onboardingComplete: boolean): Promise<CandidateProfileResponse> {
    if (Object.hasOwn(doc, "level") || !this.legacyLevel) return toResponse(doc, onboardingComplete);
    const fallback = normalizeLegacyLevel(await this.legacyLevel(doc.userId));
    return toResponse({ ...doc, level: fallback }, onboardingComplete);
  }

  /**
   * Parse a resume PDF into an unsaved draft (prefills the wizard). Nothing is stored. Upstream
   * failures (e.g. 422 for a scanned PDF) propagate so the router can surface them.
   */
  async parseResume(pdf: Uint8Array, filename: string | null): Promise<CandidateProfileResponse> {
    const raw = await this.aiService.parseResume(pdf);
    return draftFromParsedResume(parseJsonBody(raw, "/resumes/parse"), filename);
  }

  /** Start a background parse run; returns the AI service's `{run_id, status}` to poll. */
  startResumeParse(pdf: Uint8Array, filename: string): Promise<unknown> {
    return this.aiService.startResumeParseRun(pdf, filename);
  }

  /** Poll a run: running → no profile; completed → the draft; failed → a user-facing message. */
  async resumeParseRunStatus(runId: string): Promise<ResumeParseRunResponse> {
    let snap: unknown;
    try {
      snap = await this.aiService.getResumeParseRun(runId, 0);
    } catch (err) {
      if (isUpstreamStatus(err, 404)) {
        return { status: "failed", profile: null, error: "This parse expired — please upload the resume again." };
      }
      throw err;
    }
    const status = asString(path(snap, "status"), "");
    const result = path(snap, "result");
    if (status === "completed" && result !== undefined && result !== null) {
      // resumeFilename is set client-side (it has the uploaded name); the run result carries none.
      return { status: "completed", profile: draftFromParsedResume(result, null), error: null };
    }
    if (status === "failed") {
      const message = path(snap, "error", "message");
      return {
        status: "failed",
        profile: null,
        error:
          message === undefined || message === null
            ? "We couldn't parse that resume. Please try again or enter your details manually."
            : asString(message, ""),
      };
    }
    return { status: "running", profile: null, error: null };
  }

  async getProfile(userId: string): Promise<CandidateProfileResponse | null> {
    const [user, doc] = await Promise.all([this.users.findById(userId), this.profiles.findByUserId(userId)]);
    return doc ? this.response(doc, user?.onboardingComplete ?? false) : null;
  }

  async saveProfile(userId: string, req: CandidateProfileRequest): Promise<CandidateProfileResponse> {
    const user = await this.users.findById(userId);
    // The endpoint is JWT-authed against a persisted user, so this only fires if it was deleted.
    if (!user) throw new Error(`authenticated user not found: ${userId}`);

    const existing = await this.profiles.findByUserId(userId);
    if (req.level !== undefined && req.level !== null && !isEngineeringLevel(req.level)) throw new BadRequestError("Choose a valid engineering level", "invalid_level");
    const previousLevel = existing && Object.hasOwn(existing, "level") ? existing.level ?? null
      : this.legacyLevel ? normalizeLegacyLevel(await this.legacyLevel(userId)) : null;
    const level = req.level === undefined ? previousLevel : req.level;
    if (req.complete && normalizeLegacyLevel(level) === null) throw new BadRequestError("Choose an engineering level to finish onboarding", "invalid_level");

    // Stamp parse time only when the resume actually changed — re-saving the same filename on a
    // plain details edit must not keep bumping resumeParsedAt.
    let resumeFilename = existing?.resumeFilename ?? null;
    let resumeParsedAt = existing?.resumeParsedAt ?? null;
    const newFilename = trimToNull(req.resumeFilename);
    if (newFilename !== null && newFilename !== resumeFilename) {
      resumeFilename = newFilename;
      resumeParsedAt = new Date();
    }

    const saved = await this.profiles.save({
      userId,
      // Omission must not overwrite a concurrent level-only edit with our earlier read.
      ...(req.level !== undefined ? { level: req.level } : {}),
      fullName: req.fullName,
      email: req.email,
      phone: req.phone,
      location: req.location,
      headline: req.headline,
      portfolioWebsite: req.portfolioWebsite,
      targetRole: req.targetRole,
      targetJdId: req.targetJdId,
      education: listOf(req.education, education) ?? [],
      experience: listOf(req.experience, experience) ?? [],
      projects: listOf(req.projects, project) ?? [],
      skills: strList(req.skills) ?? [],
      achievements: strList(req.achievements) ?? [],
      detectedLinks: req.detectedLinks === null || req.detectedLinks === undefined ? { ...EMPTY_LINKS } : links(req.detectedLinks),
      resumeFilename,
      resumeParsedAt,
    });

    let onboardingComplete = user.onboardingComplete;
    if (req.complete && !onboardingComplete) {
      onboardingComplete = (await this.users.markOnboardingComplete(userId))?.onboardingComplete ?? true;
    }
    return this.response(saved, onboardingComplete);
  }
}

export function toResponse(doc: CandidateProfileDoc, onboardingComplete: boolean): CandidateProfileResponse {
  const detectedLinks = links(doc.detectedLinks);
  return {
    ...engineeringLevelView(doc.level),
    fullName: doc.fullName ?? null,
    email: doc.email ?? null,
    phone: doc.phone ?? null,
    location: doc.location ?? null,
    headline: doc.headline ?? null,
    portfolioWebsite: safeUrl(doc.portfolioWebsite) ?? detectedLinks.portfolioWebsite ?? null,
    targetRole: doc.targetRole ?? null,
    targetJdId: doc.targetJdId ?? null,
    education: (doc.education ?? []).map(education),
    experience: (doc.experience ?? []).map(experience),
    projects: (doc.projects ?? []).map(project),
    skills: doc.skills ?? [],
    achievements: doc.achievements ?? [],
    detectedLinks,
    resumeFilename: doc.resumeFilename ?? null,
    resumeParsedAt: doc.resumeParsedAt ?? null,
    onboardingComplete,
  };
}
