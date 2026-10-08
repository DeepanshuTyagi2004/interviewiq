import { z } from "zod";
import { UpstreamMalformedError } from "../../lib/http.js";
import type { StoredLLMAssessment } from "../../domain/profileScoring/types.js";

/** Mirrored with app/profile_scoring/models.py; this contract never contains an overall score. */
export const PROFILE_ASSESSMENT_ALGORITHM_VERSION = "profile-scoring-assessment-v1";
export const PROFILE_ASSESSMENT_PROMPT_VERSION = "profile-scoring-assessment-prompt-v5";
export const COMPANY_CONTEXT_PROMPT_VERSION = "profile-scoring-company-context-prompt-v5";

const text = (max: number) => z.string().trim().min(1).max(max);
const bounded = z.number().finite().min(0).max(100);
const featureKey = text(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).refine((key) =>
  !new Set(["score", "overall", "overallscore", "overallprofilescore", "profilescore", "finalscore",
    "finalprofilescore", "rank", "ranking", "recommendation"]).has(key.toLowerCase().replace(/[^a-z0-9]/g, "")));
const feature = z.strictObject({ key: featureKey, description: z.string().trim().max(500).nullable().default(null) });
const evidence = z.strictObject({
  id: z.string().trim().max(80).nullable().default(null),
  title: text(500),
  summary: z.string().trim().max(1000).nullable().default(null),
  technologies: z.array(text(500)).max(20).default([]),
  outcomes: z.array(text(500)).max(12).default([]),
  excerpts: z.array(text(800)).max(8).default([]),
});

export const profileScoringAssessmentRequestSchema = z.strictObject({
  userContext: z.strictObject({
    targetRole: z.string().trim().max(120).nullable().default(null),
    declaredLevel: z.string().trim().max(40).nullable().default(null),
    specialization: z.string().trim().max(120).nullable().default(null),
    yearsExperience: z.number().finite().min(0).max(80).nullable().default(null),
  }),
  projects: z.array(evidence).max(20).default([]),
  experience: z.array(evidence).max(20).default([]),
  internships: z.array(evidence).max(20).default([]),
  requestedFeatures: z.array(z.union([featureKey.transform((key) => ({ key, description: null })), feature])).min(1).max(24),
}).refine((req) => new Set(req.requestedFeatures.map((item) => item.key)).size === req.requestedFeatures.length)
  .refine((req) => JSON.stringify(req).length <= 50_000 && Buffer.byteLength(JSON.stringify(req), "utf8") <= 100_000);

export const profileScoringAssessmentResponseSchema = z.strictObject({
  assessments: z.array(z.strictObject({
    feature: featureKey,
    value: bounded,
    rationale: text(1000),
    evidenceExcerpts: z.array(text(800)).max(8),
    evidenceType: z.literal("INFERRED"),
  })).min(1).max(24),
  provider: text(120),
  model: text(200),
  generatedAt: z.string().datetime({ offset: true }),
  algorithmVersion: z.literal(PROFILE_ASSESSMENT_ALGORITHM_VERSION),
  promptVersion: z.literal(PROFILE_ASSESSMENT_PROMPT_VERSION),
});

/** Caller must supply selected, minimized snippets, never raw resumes, identity or contact fields. */
export type ProfileScoringAssessmentRequest = z.input<typeof profileScoringAssessmentRequestSchema>;
export type ProfileScoringAssessmentResponse = z.output<typeof profileScoringAssessmentResponseSchema>;
export type ProfileScoringFeatureAssessment = ProfileScoringAssessmentResponse["assessments"][number];

/** Convert a validated provider response into the engine's persisted, evidence-linked contract. */
export function toStoredLLMAssessments(
  response: ProfileScoringAssessmentResponse,
  evidenceRefsByFeature: Record<string, string[]> = {},
): StoredLLMAssessment[] {
  return response.assessments.map((assessment) => ({
    dimension: assessment.feature,
    score: assessment.value,
    // Legacy stored shape; v5 takes evidence as correct, so there is no model confidence.
    confidence: 100,
    evidenceRefs: [...new Set(evidenceRefsByFeature[assessment.feature] ?? [])],
    assessedAt: response.generatedAt,
    model: response.model,
    source: `${response.provider}:${response.promptVersion}`,
    inputHash: null,
  }));
}

export function parseProfileScoringAssessmentRequest(value: unknown): z.output<typeof profileScoringAssessmentRequestSchema> {
  const result = profileScoringAssessmentRequestSchema.safeParse(value);
  // Never attach Zod errors: issue paths and received values can contain private evidence.
  if (!result.success) throw new TypeError("Invalid minimized profile scoring assessment request");
  return result.data;
}

export function parseProfileScoringAssessmentResponse(
  value: unknown,
  request: ProfileScoringAssessmentRequest,
): ProfileScoringAssessmentResponse {
  const result = profileScoringAssessmentResponseSchema.safeParse(value);
  const invalid = () => new UpstreamMalformedError("ai-service /profile-scoring/assess returned invalid assessment data");
  if (!result.success) throw invalid();
  const req = parseProfileScoringAssessmentRequest(request);
  const expected = new Set(req.requestedFeatures.map((item) => item.key));
  const actual = result.data.assessments.map((item) => item.feature);
  if (actual.length !== expected.size || new Set(actual).size !== expected.size || actual.some((key) => !expected.has(key))) {
    throw invalid();
  }
  const snippets = [...req.projects, ...req.experience, ...req.internships]
    .flatMap((item) => [item.title, item.summary ?? "", ...item.outcomes, ...item.excerpts]);
  if (result.data.assessments.some((item) => item.evidenceExcerpts.some((quote) => !snippets.some((snippet) => snippet.includes(quote))))) {
    throw invalid();
  }
  if (result.data.assessments.some((item) => !item.evidenceExcerpts.length && item.value !== 0)) {
    throw invalid();
  }
  return result.data;
}


// --- company context (general knowledge, cached globally; never a user's own data) ------------

const nullableEnum = <T extends [string, ...string[]]>(values: T) => z.enum(values).nullable();
export const SIZE_BANDS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-20000", "20000+"] as const;

export const companyContextRequestSchema = z.strictObject({ companyName: text(120) });
export const companyContextResponseSchema = z.strictObject({
  known: z.boolean(),
  industry: z.string().trim().max(120).nullable(),
  companySize: nullableEnum([...SIZE_BANDS]),
  engineeringSize: nullableEnum([...SIZE_BANDS]),
  /** The stated headcounts behind the bands, and where they come from. */
  companyHeadcount: z.number().int().min(1).max(10_000_000).nullable().default(null),
  engineeringHeadcount: z.number().int().min(1).max(10_000_000).nullable().default(null),
  sizeEvidence: z.string().trim().max(300).nullable().default(null),
  productType: nullableEnum(["product", "services", "mixed", "non_tech"]),
  technicalDomains: z.array(text(80)).max(8),
  knownTechnologies: z.array(text(80)).max(10),
  internshipProgram: z.string().trim().max(200).nullable(),
  internshipSelectivity: bounded.nullable(),
  geographicScope: nullableEnum(["local", "national", "multinational"]),
  companyStage: nullableEnum(["startup", "growth", "late-stage", "public", "enterprise"]),
  /** Where the facts came from: model knowledge, Exa web search results (cited), or nowhere. */
  basis: z.enum(["model_knowledge", "web_search", "none"]).default("model_knowledge"),
  evidenceUrls: z.array(text(500)).max(5).default([]),
  provider: text(120),
  model: text(200),
  generatedAt: z.string().datetime({ offset: true }),
  promptVersion: z.literal(COMPANY_CONTEXT_PROMPT_VERSION),
});
export type CompanyContextResponse = z.output<typeof companyContextResponseSchema>;

/** An unknown company must come back empty: no guessed facts, no prestige-only signal. */
export function parseCompanyContextResponse(value: unknown): CompanyContextResponse {
  const result = companyContextResponseSchema.safeParse(value);
  if (!result.success) throw new UpstreamMalformedError("ai-service /profile-scoring/company-context returned invalid data");
  const data = result.data;
  if (!data.known) return { ...data, industry: null, companySize: null, engineeringSize: null, productType: null, technicalDomains: [], knownTechnologies: [],
    internshipProgram: null, internshipSelectivity: null, geographicScope: null, companyStage: null, basis: "none" as const, evidenceUrls: [],
    companyHeadcount: null, engineeringHeadcount: null, sizeEvidence: null };
  return data;
}
