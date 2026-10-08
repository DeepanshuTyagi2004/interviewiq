import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../../src/db/pg/schema.js";
import { bearer, createTestEnv, type TestEnv } from "../support/harness.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());

const PW = "correct-horse-battery";
const EXPORT = "/api/v1/users/me/export";

async function seededUser() {
  const email = `x-${randomUUID().slice(0, 8)}@example.com`;
  const { user } = await env.c.passwordAuth.register({ name: "Asha", email, password: PW });
  await env.c.repos.candidateProfiles.save({
    userId: user.id, fullName: "Asha Rao", email, phone: null, location: "Delhi", headline: null, targetRole: null, targetJdId: null,
    education: [], experience: [], projects: [], skills: ["Python"], achievements: [],
    detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: "resume.pdf", resumeParsedAt: null,
  });
  await env.c.repos.githubConnections.upsert({ userId: user.id, githubLogin: "asha", accessTokenEnc: "ENC-SECRET-TOKEN", scope: "read:user" });
  await env.c.repos.leetcodeConnections.upsertSyncing(user.id, "asha_lc");
  await env.c.repos.fragments.insert({ userId: user.id, source: "LEETCODE", data: { solved: { total: 412 } }, contentHash: "h1", version: 1, fetchedAt: new Date() });
  const session = await env.c.repos.sessions.insert({
    candidateId: user.id, jobDescriptionId: randomUUID(), company: "meesho", role: "software-engineer", level: "sde1",
    roundType: "dsa", scheduledAt: new Date(), timezone: "Asia/Kolkata", status: "PREP_READY",
    prepBriefing: { interviewer_name: "Asha Rao", interviewer_style: "Senior engineer", format: "45-minute coding interview", duration_mins: 45 },
  });
  await env.c.preferences.update(user.id, { interview: { pace: "faster" } });
  return { user, session };
}

describe("GET /users/me/export", () => {
  it("401 without a token", async () => {
    expect((await env.http.get(EXPORT)).status).toBe(401);
  });

  it("returns everything the API holds about the user as a JSON attachment", async () => {
    const { user, session } = await seededUser();
    const res = await env.http.get(EXPORT).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="interviewiq-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.body.user).toMatchObject({ id: user.id, email: user.email, hasPassword: true });
    expect(res.body.preferences.interview.pace).toBe("faster");
    expect(res.body.candidateProfile).toMatchObject({ fullName: "Asha Rao", skills: ["Python"] });
    expect(res.body.candidateProfile).not.toHaveProperty("_id");
    expect(res.body.connections.github).toMatchObject({ login: "asha", scope: "read:user" });
    expect(res.body.connections.leetcode).toMatchObject({ username: "asha_lc" });
    expect(res.body.profileFragments).toEqual([expect.objectContaining({ source: "LEETCODE", data: { solved: { total: 412 } } })]);
    expect(res.body.interviewSessions).toEqual([expect.objectContaining({ id: session.id, company: "meesho" })]);
    expect(res.body.interviewSessions[0].prepBriefing).toMatchObject({ interviewer_name: "Asha Rao" });
    expect(res.body).not.toHaveProperty("sessionOutcomes");
    expect(res.body.notes).toEqual([expect.stringContaining("Interview blueprints")]);
  });

  it("never includes secrets", async () => {
    const { user } = await seededUser();
    const [row] = await env.db.select().from(users).where(eq(users.id, user.id));
    const text = JSON.stringify((await env.http.get(EXPORT).set("Authorization", await bearer(env, user))).body);
    expect(text).not.toContain("ENC-SECRET-TOKEN");
    expect(text).not.toContain(row!.passwordHash!);
    expect(text).not.toMatch(/passwordHash|accessTokenEnc|tokenHash|googleSub/);
  });

  it("works for a user with nothing connected", async () => {
    const { user } = await env.c.passwordAuth.register({ name: "New", email: `n-${randomUUID().slice(0, 8)}@example.com`, password: PW });
    const res = await env.http.get(EXPORT).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      candidateProfile: null,
      connections: { github: null, leetcode: null },
      profileFragments: [],
      interviewSessions: [],
    });
  });
});
