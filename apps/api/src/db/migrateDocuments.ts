import type { AnyBulkWriteOperation } from "mongodb";
import { education, experience, links, listOf, project, str, strList } from "../domain/candidateProfile.js";
import { PROFILE_SOURCES, type ProfileSource } from "../domain/enums.js";
import { sortDeep } from "../lib/canonicalJson.js";
import { isObject } from "../lib/json.js";
import { type CandidateProfileDoc, ensureMongoIndexes, type MongoCollections, type ProfileFragmentDoc } from "./mongo/client.js";

/**
 * Copy the document-shaped data the Spring backend kept in Postgres jsonb into MongoDB:
 *
 *   candidate_profile           → candidate_profiles  (_id = user_id)
 *   profile_fragment            → profile_fragments   (unique userId+source)
 *
 * (Legacy live-session outcomes are no longer migrated: the old live agent and its outcomes were removed.)
 *
 * Postgres is only READ. Documents that already exist in Mongo are kept (the API may have written
 * newer data since the cutover) unless `overwrite`. Safe to re-run.
 */

/** Minimal query surface — satisfied by a node-postgres Pool (and adaptable for tests). */
export type SqlQuery = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export interface MigrationReport {
  table: string;
  rows: number;
  inserted: number;
  replaced: number;
  skipped: string | null;
}

export async function migrateDocuments(opts: {
  query: SqlQuery;
  mongo: MongoCollections;
  dryRun?: boolean;
  overwrite?: boolean;
  warn?: (msg: string) => void;
}): Promise<MigrationReport[]> {
  const { query, mongo, dryRun = false, overwrite = false, warn = () => {} } = opts;
  const reports: MigrationReport[] = [];

  const tableExists = async (name: string) => (await query("select to_regclass($1) as t", [`public.${name}`])).rows[0]?.t != null;
  const columnExists = async (table: string, column: string) =>
    (await query("select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2", [table, column]))
      .rows.length > 0;

  const upsert = <T extends { _id: string }>(filter: Record<string, unknown>, doc: T): AnyBulkWriteOperation<T> =>
    (overwrite
      ? { replaceOne: { filter, replacement: doc, upsert: true } }
      : { updateOne: { filter, update: { $setOnInsert: doc }, upsert: true } }) as AnyBulkWriteOperation<T>;

  const write = async <T extends { _id: string }>(
    table: string,
    coll: { bulkWrite(ops: AnyBulkWriteOperation<T>[]): Promise<{ upsertedCount: number; modifiedCount: number }> },
    ops: AnyBulkWriteOperation<T>[],
  ) => {
    if (dryRun || ops.length === 0) {
      reports.push({ table, rows: ops.length, inserted: 0, replaced: 0, skipped: null });
      return;
    }
    const r = await coll.bulkWrite(ops);
    reports.push({ table, rows: ops.length, inserted: r.upsertedCount, replaced: r.modifiedCount, skipped: null });
  };

  if (!dryRun) await ensureMongoIndexes(mongo);

  // --- candidate_profile ------------------------------------------------------------------
  if (await tableExists("candidate_profile")) {
    const { rows } = await query("select * from candidate_profile");
    await write(
      "candidate_profile",
      mongo.candidateProfiles,
      rows.map((r) => {
        const userId = String(r.user_id);
        return upsert<CandidateProfileDoc>(
          { _id: userId },
          {
            _id: userId,
            userId,
            fullName: str(r.full_name),
            email: str(r.email),
            phone: str(r.phone),
            location: str(r.location),
             headline: str(r.headline),
             portfolioWebsite: str(r.portfolio_website),
            targetRole: str(r.target_role),
            education: listOf(parseJson(r.education), education) ?? [],
            experience: listOf(parseJson(r.experience), experience) ?? [],
            projects: listOf(parseJson(r.projects), project) ?? [],
            skills: strList(parseJson(r.skills)) ?? [],
            achievements: strList(parseJson(r.achievements)) ?? [],
            detectedLinks: links(parseJson(r.detected_links)),
            resumeFilename: str(r.resume_filename),
            resumeParsedAt: date(r.resume_parsed_at),
            createdAt: date(r.created_at) ?? new Date(),
            updatedAt: date(r.updated_at) ?? new Date(),
          },
        );
      }),
    );
  } else {
    reports.push({ table: "candidate_profile", rows: 0, inserted: 0, replaced: 0, skipped: "table not found" });
  }

  // --- profile_fragment -------------------------------------------------------------------
  if (await tableExists("profile_fragment")) {
    const { rows } = await query("select * from profile_fragment");
    const ops: AnyBulkWriteOperation<ProfileFragmentDoc>[] = [];
    for (const r of rows) {
      const source = String(r.source) as ProfileSource;
      if (!PROFILE_SOURCES.includes(source)) {
        warn(`profile_fragment ${String(r.id)}: unknown source ${source} — skipped`);
        continue;
      }
      const data = parseJson(r.data);
      const userId = String(r.user_id);
      ops.push(
        upsert<ProfileFragmentDoc>(
          { userId, source },
          {
            _id: String(r.id),
            userId,
            source,
            // jsonb reorders keys; store the canonical (sorted) form the hash was computed over.
            data: (isObject(data) ? sortDeep(data) : {}) as Record<string, unknown>,
            contentHash: String(r.content_hash),
            version: Number(r.version ?? 1),
            fetchedAt: date(r.fetched_at) ?? new Date(),
          },
        ),
      );
    }
    await write("profile_fragment", mongo.profileFragments, ops);
  } else {
    reports.push({ table: "profile_fragment", rows: 0, inserted: 0, replaced: 0, skipped: "table not found" });
  }

  return reports;
}

/** jsonb normally arrives parsed; tolerate text too. */
function parseJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function date(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
