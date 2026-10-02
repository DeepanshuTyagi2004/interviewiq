import { type Collection, type Db, MongoClient } from "mongodb";
import type { EducationDto, ExperienceDto, ProjectDto, ResumeLinksDto } from "../../domain/candidateProfile.js";
import type { ProfileSource } from "../../domain/enums.js";

/**
 * Document data in MongoDB (Atlas in production, the local container in dev):
 *
 *   candidate_profiles  one per user (_id = userId) — the onboarding/profile-page details, with
 *                       native arrays instead of the old Postgres jsonb strings
 *   profile_fragments   one per (user, source) — the normalized, hash-versioned Profile Builder
 *                       inputs (GitHub / LeetCode)
 *   session_outcomes    one per interview session (_id = sessionId) — the full SessionOutcome
 *                       JSON the live-interview worker posts at the end
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
  targetRole: string | null;
  /** Absent on documents written before the Target step stored an id. */
  targetJdId?: string | null;
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

export interface SessionOutcomeDoc {
  _id: string;
  /** The worker's SessionOutcome, stored verbatim. */
  outcome: Record<string, unknown>;
  receivedAt: Date;
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
  sessionOutcomes: Collection<SessionOutcomeDoc>;
  userPreferences: Collection<UserPreferencesDoc>;
}

export function collections(db: Db): MongoCollections {
  return {
    candidateProfiles: db.collection<CandidateProfileDoc>("candidate_profiles"),
    profileFragments: db.collection<ProfileFragmentDoc>("profile_fragments"),
    sessionOutcomes: db.collection<SessionOutcomeDoc>("session_outcomes"),
    userPreferences: db.collection<UserPreferencesDoc>("user_preferences"),
  };
}

export async function ensureMongoIndexes(c: MongoCollections): Promise<void> {
  await c.profileFragments.createIndex({ userId: 1, source: 1 }, { unique: true, name: "uq_fragment_user_source" });
}

export async function connectMongo(uri: string, database: string): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000, appName: "interviewiq-api" });
  await client.connect();
  const db = client.db(database);
  await db.command({ ping: 1 });
  return { client, db };
}
