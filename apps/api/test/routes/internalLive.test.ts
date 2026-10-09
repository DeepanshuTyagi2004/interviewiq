import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { bearer, createTestEnv, createUser, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { seedCompany, seedJd, seedSession } from "./helpers.js";

let env: TestEnv;
let jd: JobDescriptionRow;
const ctx = (id: string) => `/api/v1/internal/live/sessions/${id}/context`;
const end = (id: string) => `/api/v1/internal/live/sessions/${id}/end`;

beforeAll(async () => {
  env = await createTestEnv();
  await seedCompany(env, "google", "Google");
  jd = await seedJd(env);
});
afterAll(() => env.close());

describe("internal live endpoints", () => {
  it("gives the worker the round and a minimal profile, only while live", async () => {
    const user = await createUser(env, { name: "Asha Rao" });
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(),
      prepBriefing: { interviewer_name: "Siddharth", interviewer_style: "warm", format: "coding", duration_mins: 45 } });
    const res = await env.http.get(ctx(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ session_id: s.id, candidate_id: user.id, first_name: "Asha", status: "LIVE_IN_PROGRESS",
      round: { company: "google", company_name: "Google", round_type: "dsa", duration_mins: 45 } });
    expect(res.body.profile).toEqual({ headline: null, skills: [], projects: [] }); // a user with no profile yet
    expect(JSON.stringify(res.body)).not.toContain("@");

    const ready = await seedSession(env, user.id, jd, { status: "PREP_READY" });
    expect((await env.http.get(ctx(ready.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY)).body.code).toBe("session_not_live");
    expect((await env.http.get(ctx(s.id))).status).toBe(401);
  });

  it("ends a live round once, storing the reason, duration and summary", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(Date.now() - 600_000) });
    const body = { reason: "ended_by_interviewer", live_summary: { tab_changes: 3, screen_changes_weighted: 0.5, full_violations: 3, conduct_incidents: 0 } };
    const first = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send(body);
    expect(first.body).toEqual({ status: "COMPLETED", ended_reason: "ended_by_interviewer", already_ended: false });
    const row = (await env.c.repos.sessions.findById(s.id))!;
    expect(row.endedReason).toBe("ended_by_interviewer");
    expect(row.liveSummary).toMatchObject({ tab_changes: 3, full_violations: 3 });
    expect(row.durationS).toBeGreaterThanOrEqual(599);
    const again = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send({ reason: "completed" });
    expect(again.body).toEqual({ status: "COMPLETED", ended_reason: "ended_by_interviewer", already_ended: true });
  });

  it("lets the interviewer's report replace a candidate fallback that closed the round without a summary", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(Date.now() - 600_000) });
    // The browser's End fallback wins the race: the round closes as candidate_ended with no summary.
    const fallback = await env.http.post(`/api/v1/interviews/sessions/${s.id}/live/end`).set("Authorization", await bearer(env, user));
    expect(fallback.body.endReason).toBe("candidate_ended");
    const summary = { tab_changes: 3, screen_changes_weighted: 0, full_violations: 3, conduct_incidents: 0 };
    const report = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY)
      .send({ reason: "ended_by_interviewer", live_summary: summary });
    expect(report.body).toEqual({ status: "COMPLETED", ended_reason: "ended_by_interviewer", already_ended: true });
    const row = (await env.c.repos.sessions.findById(s.id))!;
    expect(row.endedReason).toBe("ended_by_interviewer");
    expect(row.liveSummary).toMatchObject({ tab_changes: 3, full_violations: 3 });
    // A report that already carries a summary is final: a later one changes nothing.
    const later = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send({ reason: "completed", live_summary: {} });
    expect(later.body).toEqual({ status: "COMPLETED", ended_reason: "ended_by_interviewer", already_ended: true });
    expect((await env.c.repos.sessions.findById(s.id))!.liveSummary).toMatchObject({ full_violations: 3 });
  });

  it("ends a technical failure as ABORTED_TECHNICAL and rejects bad bodies", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date() });
    const res = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send({ reason: "technical", live_summary: {} });
    expect(res.body.status).toBe("ABORTED_TECHNICAL");
    const bad = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send({ reason: "bored" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("live_end_bad_request");
  });

  it("carries the skills, headline and project names of a saved profile, and no contact details", async () => {
    const user = await createUser(env, { name: "Asha Rao", email: "asha.private@example.com" });
    const save = await env.http.put("/api/v1/users/me/candidate-profile").set("Authorization", await bearer(env, user)).send({
      fullName: "Asha Rao", email: "asha.private@example.com", phone: "+91 90000 00000", location: "Delhi", headline: "Backend engineer",
      targetRole: "SDE", education: [], experience: [], achievements: [], detectedLinks: { github: null, leetcode: null, linkedin: null },
      projects: [{ name: "Split app", description: "Splits bills", tech: ["Java"], bullets: [], link: null }],
      skills: ["Java", "SQL"], resumeFilename: "resume.pdf", complete: true, level: "fresher",
    });
    expect(save.status).toBe(200);
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date() });
    const res = await env.http.get(ctx(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY);
    expect(res.body.profile).toEqual({ headline: "Backend engineer", skills: ["Java", "SQL"], projects: ["Split app"] });
    const flat = JSON.stringify(res.body);
    for (const secret of ["asha.private@example.com", "90000", "Delhi"]) expect(flat).not.toContain(secret);
  });
});
