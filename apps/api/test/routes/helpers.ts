import type { InterviewSessionRow, JobDescriptionRow } from "../../src/db/pg/schema.js";
import type { companyRoleConfigs, interviewSessions, jobDescriptions } from "../../src/db/pg/schema.js";
import type { RecordedCall } from "../support/fakeFetch.js";
import type { TestEnv } from "../support/harness.js";

/** AI service base URL the harness configures. */
export const AI = "http://ai.test";

/** A tiny "PDF" — the API only sniffs content-type / extension, never the bytes. */
export const PDF_BYTES = Buffer.from("%PDF-1.4 fake");

/** A slot comfortably in the future (booking rejects past slots). */
export const FUTURE_SLOT = "2099-07-10T10:00:00.000Z";

type Env = Pick<TestEnv, "c">;

export async function seedCompany(env: Env, slug: string, name: string): Promise<void> {
  await env.c.repos.companies.insert({ name, slug, tier: 2 });
}

export async function seedRoleConfig(env: Env, overrides: Partial<typeof companyRoleConfigs.$inferInsert> = {}): Promise<void> {
  await env.c.repos.roleConfigs.insert({ company: "google", role: "software-engineer", level: "sde1", enabled: true, ...overrides });
}

export function seedJd(env: Env, overrides: Partial<typeof jobDescriptions.$inferInsert> = {}): Promise<JobDescriptionRow> {
  return env.c.repos.jds.insert({
    company: "google",
    role: "software-engineer",
    level: "sde1",
    title: "SDE 1",
    specialization: "backend",
    description: "Build things",
    techStack: "Java, Spring",
    sourceUrl: null,
    source: "seed",
    active: true,
    ...overrides,
  });
}

export function seedSession(
  env: Env,
  candidateId: string,
  jd: JobDescriptionRow,
  overrides: Partial<typeof interviewSessions.$inferInsert> = {},
): Promise<InterviewSessionRow> {
  return env.c.repos.sessions.insert({
    candidateId,
    jobDescriptionId: jd.id,
    company: jd.company,
    role: jd.role,
    level: jd.level,
    specialization: jd.specialization,
    roundType: "dsa",
    scheduledAt: new Date(FUTURE_SLOT),
    timezone: "Asia/Kolkata",
    status: "SCHEDULED",
    ...overrides,
  });
}

/** The raw bytes a recorded upstream call sent, as a Buffer. */
export function sentBytes(call: RecordedCall | undefined): Buffer {
  const body = call?.body;
  if (body === undefined) return Buffer.alloc(0);
  return typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
}

/** Only the calls that reached the AI service. */
export function aiCalls(env: Pick<TestEnv, "fetch">): RecordedCall[] {
  return env.fetch.callsTo(AI);
}
