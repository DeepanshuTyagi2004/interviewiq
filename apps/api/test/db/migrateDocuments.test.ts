import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MongoCollections } from "../../src/db/mongo/client.js";
import { migrateDocuments, type SqlQuery } from "../../src/db/migrateDocuments.js";
import { canonicalize, sha256Hex } from "../../src/lib/canonicalJson.js";
import { CandidateProfileRepository } from "../../src/repositories/mongo.js";
import { toResponse } from "../../src/services/candidateProfileService.js";
import { createTestMongo } from "../support/harness.js";

const HIBERNATE_DDL = readFileSync(new URL("../fixtures/hibernate-schema.sql", import.meta.url), "utf8");

let pg: PGlite;
let query: SqlQuery;
let mongo: MongoCollections;
let closeMongo: () => Promise<void>;

const userId = randomUUID();
const sessionId = randomUUID();
const fragmentData = { login: "asha", languages: [{ name: "Go", pct: 70, bytes: 7000 }], contributions: { lastYear: 12, weeks: [[1, 0]] }, externalPRs: 2 };
const fragmentHash = sha256Hex(canonicalize(fragmentData));

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(HIBERNATE_DDL);
  query = async (text, params) => ({ rows: (await pg.query<Record<string, unknown>>(text, params)).rows });

  // Legacy rows exactly as the Spring app stored them (jsonb columns).
  await pg.query(
    `insert into candidate_profile (id, user_id, full_name, email, headline, target_role, education, experience, projects, skills,
       achievements, detected_links, resume_filename, resume_parsed_at, created_at, updated_at)
     values ($1, $2, 'Asha Rao', 'asha@example.com', 'Backend dev', 'SDE', $3, $4, $5, $6, $7, $8, 'cv.pdf', now(), now(), now())`,
    [
      randomUUID(),
      userId,
      JSON.stringify([{ institution: "IIT", degree: "BTech", field: "CS", startYear: "2019", endYear: "2023", grade: "8.9" }]),
      JSON.stringify([{ company: "Acme", title: "Intern", startDate: "2022", endDate: null, location: null, bullets: ["Built X"] }]),
      JSON.stringify([{ name: "Proj", description: null, tech: ["Go"], bullets: [], link: null }]),
      JSON.stringify(["Go", "SQL"]),
      JSON.stringify(["SIH finalist"]),
      JSON.stringify({ github: "https://github.com/asha", leetcode: null, linkedin: null }),
    ],
  );
  await pg.query(
    `insert into profile_fragment (id, user_id, source, data, content_hash, version, fetched_at) values ($1, $2, 'GITHUB', $3, $4, 3, now())`,
    [randomUUID(), userId, JSON.stringify(fragmentData), fragmentHash],
  );
  await pg.query(
    `insert into interview_sessions (id, candidate_id, job_description_id, company, role, level, round_type, scheduled_at, timezone,
       status, created_at, updated_at, live_ended_at, outcome)
     values ($1, $2, $3, 'meesho', 'software-engineer', 'fresher', 'dsa', now(), 'UTC', 'COMPLETED', now(), now(), now(), $4)`,
    [sessionId, userId, randomUUID(), JSON.stringify({ ended_reason: "natural", live_score_final: 7.5, transcript: [{ who: "ai", text: "hi" }] })],
  );

  ({ mongo, close: closeMongo } = await createTestMongo());
});

afterAll(async () => {
  await pg.close();
  await closeMongo();
});

describe("migrateDocuments (legacy Postgres jsonb → MongoDB)", () => {
  it("dry run counts rows and writes nothing", async () => {
    const reports = await migrateDocuments({ query, mongo, dryRun: true });
    expect(reports.map((r) => [r.table, r.rows])).toEqual([
      ["candidate_profile", 1],
      ["profile_fragment", 1],
      ["interview_sessions.outcome", 1],
    ]);
    expect(await mongo.candidateProfiles.countDocuments()).toBe(0);
  });

  it("copies all three kinds of documents", async () => {
    const reports = await migrateDocuments({ query, mongo });
    expect(reports.every((r) => r.inserted === 1)).toBe(true);

    const profile = await new CandidateProfileRepository(mongo).findByUserId(userId);
    expect(profile).not.toBeNull();
    const response = toResponse(profile!, true);
    expect(response).toMatchObject({
      fullName: "Asha Rao",
      targetRole: "SDE",
      skills: ["Go", "SQL"],
      achievements: ["SIH finalist"],
      detectedLinks: { github: "https://github.com/asha", leetcode: null, linkedin: null },
      resumeFilename: "cv.pdf",
    });
    expect(response.education[0]).toEqual({ institution: "IIT", degree: "BTech", field: "CS", startYear: "2019", endYear: "2023", grade: "8.9" });
    expect(response.experience[0]?.bullets).toEqual(["Built X"]);

    const fragment = await mongo.profileFragments.findOne({ userId, source: "GITHUB" });
    expect(fragment).toMatchObject({ contentHash: fragmentHash, version: 3 });
    // stored canonically, so the recorded hash still matches its data
    expect(sha256Hex(canonicalize(fragment!.data))).toBe(fragmentHash);

    const outcome = await mongo.sessionOutcomes.findOne({ _id: sessionId });
    expect(outcome?.outcome).toMatchObject({ ended_reason: "natural", live_score_final: 7.5 });
  });

  it("re-running keeps existing Mongo documents unless --overwrite", async () => {
    await mongo.candidateProfiles.updateOne({ _id: userId }, { $set: { headline: "edited after cutover" } });
    const again = await migrateDocuments({ query, mongo });
    expect(again.every((r) => r.inserted === 0)).toBe(true);
    expect((await mongo.candidateProfiles.findOne({ _id: userId }))?.headline).toBe("edited after cutover");

    await migrateDocuments({ query, mongo, overwrite: true });
    expect((await mongo.candidateProfiles.findOne({ _id: userId }))?.headline).toBe("Backend dev");
  });

  it("skips gracefully when the legacy tables are gone", async () => {
    const empty = new PGlite();
    const reports = await migrateDocuments({ query: async (t, p) => ({ rows: (await empty.query<Record<string, unknown>>(t, p)).rows }), mongo, dryRun: true });
    expect(reports.map((r) => r.skipped)).toEqual(["table not found", "table not found", "column not found"]);
    await empty.close();
  });
});
