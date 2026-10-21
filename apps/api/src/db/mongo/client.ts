import { type Collection, type Db, MongoClient } from "mongodb";
import type { EducationDto, ExperienceDto, ProjectDto, ResumeLinksDto } from "../../domain/candidateProfile.js";
import type { ProfileSource } from "../../domain/enums.js";
import type { LinkedInImportDoc, LinkedInImportLockDoc } from "../../repositories/linkedinImports.js";
import type { CompanyKnowledgeDoc, ProfileScoreDoc, ProfileScoringJobDoc, ProfileScoringLeaseDoc, ProfileScoringSettingsDoc, SemanticAssessmentDoc } from "../../repositories/profileScoring.js";
import type { ValidationControlsDoc } from "../../repositories/validationControls.js";

/**
 * Document data in MongoDB (Atlas in production, the local container in dev):
 *
 *   candidate_profiles  one per user (_id = userId) — the onboarding/profile-page details, with
 *                       native arrays instead of the old Postgres jsonb strings
 *   profile_fragments   one per (user, source) — the normalized, hash-versioned Profile Builder
 *                       inputs (GitHub / LeetCode)
 *   blueprint_seen      one per (candidate, problem) — problems a candidate was given in a live
 *                       interview, excluded from their later blueprints (no repeats on retakes)
 *   round_reports       one per (session, version) — the graded post-interview report, append-only
 *   user_preferences    one per user (_id = userId) — only the settings the user changed; reads
 *                       overlay them on DEFAULT_PREFERENCES (domain/preferences.ts)
 *
 * The API uses its own database (MONGODB_DATABASE, default `interviewiq`), separate from the AI
 * service's `interviewiq_intelligence` — both can share one Atlas cluster.
 */

export interface CandidateProfileDoc {
  _id: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  /** Optional portfolio URL; absent on documents written before portfolio links were supported. */
  portfolioWebsite?: string | null;
  targetRole: string | null;
  /** Absent on documents written before the Target step stored an id. */
  targetJdId?: string | null;
  /** Optional for old documents; saved legacy labels are normalized on read only. */
  level?: string | null;
  education: EducationDto[];
  experience: ExperienceDto[];
  projects: ProjectDto[];
  skills: string[];
  achievements: string[];
  detectedLinks: ResumeLinksDto;
  resumeFilename: string | null;
  resumeParsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Opaque full-write revision; level-only writes advance updatedAt atomically. */
  revision?: string;
}

export interface ProfileFragmentDoc {
  _id: string;
  userId: string;
  source: ProfileSource;
  /** The canonical (key-sorted) normalized fragment. */
  data: Record<string, unknown>;
  /** Hex SHA-256 of the canonical JSON — skip rewrites when unchanged. */
  contentHash: string;
  version: number;
  fetchedAt: Date;
}

export interface BlueprintSeenDoc {
  _id: string;
  candidateId: string;
  slug: string;
  roundType: string;
  sessionId: string;
  at: Date;
}

/** One graded report per (session, version); versions are append-only so a re-evaluation never overwrites the first. */
export interface RoundReportDoc {
  _id: string;
  sessionId: string;
  candidateId: string;
  version: number;
  report: unknown;
  createdAt: Date;
  /** The target of the dispute re-check started on this version, while it runs (the next version supersedes it). */
  recheck?: { type: "question" | "area"; id: string } | null;
}

export interface UserPreferencesDoc {
  _id: string;
  /** Partial sections: only the leaves the user changed. Validated on every read. */
  locale?: Record<string, unknown>;
  interview?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  privacy?: Record<string, unknown>;
  updatedAt: Date;
}

export interface MongoCollections {
  candidateProfiles: Collection<CandidateProfileDoc>;
  profileFragments: Collection<ProfileFragmentDoc>;
  blueprintSeen: Collection<BlueprintSeenDoc>;
  userPreferences: Collection<UserPreferencesDoc>;
  roundReports: Collection<RoundReportDoc>;
  profileScoringSettings: Collection<ProfileScoringSettingsDoc>;
  profileScoreSnapshots: Collection<ProfileScoreDoc>;
  profileScoringJobs: Collection<ProfileScoringJobDoc>;
  profileScoringLeases: Collection<ProfileScoringLeaseDoc>;
  profileScoringSemantic: Collection<SemanticAssessmentDoc>;
  profileScoringCompanies: Collection<CompanyKnowledgeDoc>;
  linkedinImports: Collection<LinkedInImportDoc>;
  linkedinImportLocks: Collection<LinkedInImportLockDoc>;
  validationControls: Collection<ValidationControlsDoc>;
}

export function collections(db: Db): MongoCollections {
  return {
    candidateProfiles: db.collection<CandidateProfileDoc>("candidate_profiles"),
    profileFragments: db.collection<ProfileFragmentDoc>("profile_fragments"),
    blueprintSeen: db.collection<BlueprintSeenDoc>("blueprint_seen"),
    userPreferences: db.collection<UserPreferencesDoc>("user_preferences"),
    roundReports: db.collection<RoundReportDoc>("round_reports"),
    profileScoringSettings: db.collection<ProfileScoringSettingsDoc>("profile_scoring_settings"),
    profileScoreSnapshots: db.collection<ProfileScoreDoc>("profile_score_snapshots"),
    profileScoringJobs: db.collection<ProfileScoringJobDoc>("profile_scoring_jobs"),
    profileScoringLeases: db.collection<ProfileScoringLeaseDoc>("profile_scoring_leases"),
    profileScoringSemantic: db.collection<SemanticAssessmentDoc>("profile_scoring_semantic_assessments"),
    profileScoringCompanies: db.collection<CompanyKnowledgeDoc>("profile_scoring_company_kb"),
    linkedinImports: db.collection<LinkedInImportDoc>("linkedin_import_drafts"),
    linkedinImportLocks: db.collection<LinkedInImportLockDoc>("linkedin_import_locks"),
    // The fixed singleton _id uses MongoDB's built-in unique _id index; no TTL/user ownership.
    validationControls: db.collection<ValidationControlsDoc>("validation_controls"),
  };
}

export async function ensureMongoIndexes(c: MongoCollections): Promise<void> {
  await c.profileFragments.createIndex({ userId: 1, source: 1 }, { unique: true, name: "uq_fragment_user_source" });
  await c.blueprintSeen.createIndex({ candidateId: 1, slug: 1 }, { unique: true, name: "uq_seen_candidate_slug" });
  await c.roundReports.createIndex({ sessionId: 1, version: 1 }, { unique: true, name: "uq_round_report_session_version" });
  await c.roundReports.createIndex({ candidateId: 1 }, { name: "idx_round_report_candidate" });
  await c.profileScoreSnapshots.createIndex({ userId: 1, "snapshot.calculatedAt": -1 });
  await c.profileScoreSnapshots.createIndex({ "snapshot.week": 1, "snapshot.calculatedAt": -1 });
  await c.profileScoringJobs.createIndex({ startedAt: -1 });
  await c.profileScoringSemantic.createIndex({ userId: 1 });
  await c.linkedinImports.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await c.linkedinImports.createIndex({ userId: 1 });
  await c.linkedinImportLocks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export async function connectMongo(uri: string, database: string): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, appName: "interviewiq-api" });
  await client.connect();
  const db = client.db(database);
  await db.command({ ping: 1 });
  return { client, db };
}
