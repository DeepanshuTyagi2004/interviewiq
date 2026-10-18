import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { InterviewSessionRow, JobDescriptionRow, LoopRow, UserRow } from "../../src/db/pg/schema.js";
import { MOCK_ROUND_MINUTES } from "../../src/domain/liveRound.js";
import { fingerprint, PREP_VERSION, profileProjection, resolveRound } from "../../src/services/blueprintPrep.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { AI, seedJd, seedSession } from "../routes/helpers.js";

/**
 * BlueprintPrepService (spec §5): input assembly + fingerprint, and how finished runs are applied:
 * success → PREP_READY with version + briefing; changed inputs → superseded and restarted; failure →
 * PREP_FAILED (first prep) or kept blueprint (refresh); stuck → timeout.
 */

let env: TestEnv;
let user: UserRow;
let jd: JobDescriptionRow;

const BRIEFING = { interviewer_name: "Asha Rao", interviewer_style: "Senior engineer · calm", format: "45-minute coding interview with a shared editor", duration_mins: 45 };

beforeAll(async () => {
  env = await createTestEnv();
  jd = await seedJd(env, { company: "google", role: "software-engineer", level: "sde1", specialization: "backend" });
});
afterAll(() => env.close());
beforeEach(async () => {
  env.fetch.reset();
  user = await createUser(env);
});

const row = async (id: string) => (await env.c.repos.sessions.findById(id))!;

async function withRun(overrides: Partial<InterviewSessionRow> = {}): Promise<InterviewSessionRow> {
  return seedSession(env, user.id, jd, { status: "PREP_QUEUED", prepRunId: "bpr_1", prepRunStartedAt: new Date(), ...overrides });
}

describe("inputs", () => {
  it("fingerprint ignores key order and the trigger, but not the inputs", async () => {
    const s = await seedSession(env, user.id, jd);
    const a = await env.c.blueprintPrep.assemble(s, "booking");
    const b = await env.c.blueprintPrep.assemble(s, "refresh");
    expect(a.input_hash).toBe(b.input_hash);
    const { input_hash: _h, input_parts: _p, ...body } = a;
    const changed = fingerprint({ ...body, exclusions: ["two-sum"] });
    expect(changed.hash).not.toBe(a.input_hash);
    expect(changed.parts.exclusions).not.toBe(a.input_parts.exclusions);
    expect(changed.parts.jd).toBe(a.input_parts.jd);
  });

  it("the fingerprint carries the prep version, so a version bump re-prepares ready sessions", async () => {
    const s = await seedSession(env, user.id, jd);
    const a = await env.c.blueprintPrep.assemble(s, "booking");
    const expected = createHash("sha256").update(JSON.stringify(PREP_VERSION)).digest("hex").slice(0, 16);
    expect(PREP_VERSION).toBe("shapes-1");
    expect(a.input_parts.prep).toBe(expected);
    expect(expected).toBe(createHash("sha256").update('"shapes-1"').digest("hex").slice(0, 16));
    expect(expected).not.toBe(createHash("sha256").update(JSON.stringify("shapes-2")).digest("hex").slice(0, 16));
  });

  it("the profile projection carries no contact details and sums full-time years only", () => {
    const p = profileProjection({
      level: "sde1", fullName: "Asha", email: "a@x.com", phone: "999", location: "Delhi", headline: "Backend dev",
      targetRole: null, education: [{ institution: "KIET", degree: "B.Tech", field: "CSE", startYear: "2019", endYear: "2023", grade: null }],
      experience: [
        { company: "Razorpay", title: "Software Engineer", startDate: "2023", endDate: "Present", location: null, bullets: ["Built payouts"] },
        { company: "Acme", title: "SDE Intern", startDate: "2022", endDate: "2022", location: null, bullets: [] },
      ],
      projects: [{ name: "Split app", description: "Splits bills", tech: ["Spring"], bullets: null, link: "http://x" }],
      skills: ["Java"], achievements: ["Won a hackathon"], detectedLinks: { github: "g", leetcode: null, linkedin: null },
    } as never, new Map([["LEETCODE", { solved: { easy: 10, medium: 20, hard: 5 } }]]));
    const text = JSON.stringify(p);
    expect(text).not.toMatch(/a@x\.com|999|Delhi|http:\/\/x|hackathon/);
    expect(p.experience.map((e) => e.internship)).toEqual([false, true]);
    expect(p.years_experience).toBe(new Date().getFullYear() - 2023);
    expect(p.coding).toMatchObject({ total_solved: 35, easy: 10, medium: 20, hard: 5 });
  });

  it("resolves the round from the practice snapshot, then the loop node, then the brief", () => {
    const brief = { final_experience: { rounds: [
      { id: "r1", type: "behavioural", kind: "interview", topics: ["teamwork"] },
      { id: "r2", type: "dsa", kind: "interview", name: "Coding", duration_minutes: 50, topics: ["graphs"], problems: ["Two Sum"], difficulty: "hard", format: "two problems" },
    ] } };
    const session = { roundType: "dsa", practicePrep: null, nodeId: null } as unknown as InterviewSessionRow;
    // The researched 50 minutes describes the real round; the mock is always 45.
    expect(resolveRound(session, brief, null)).toEqual({ type: "dsa", name: "Coding", duration_mins: MOCK_ROUND_MINUTES, format: "two problems",
      topics: ["graphs"], problems: ["Two Sum"], difficulty: "hard", source: "brief" });
    expect(resolveRound({ ...session, roundType: "lld" } as InterviewSessionRow, brief, null)).toBeNull();
  });

  it("always asks for a 45-minute mock round, whatever length was stored or researched", () => {
    expect(MOCK_ROUND_MINUTES).toBe(45);
    const base = { roundType: "dsa", practicePrep: null, nodeId: null } as unknown as InterviewSessionRow;
    const brief = { final_experience: { rounds: [{ id: "r1", type: "dsa", kind: "interview", name: "Coding", duration_minutes: 90 }] } };
    // brief match
    expect(resolveRound(base, brief, null)!.duration_mins).toBe(MOCK_ROUND_MINUTES);
    // brief round with no researched length
    expect(resolveRound(base, { final_experience: { rounds: [{ id: "r1", type: "dsa", kind: "interview" }] } }, null)!.duration_mins).toBe(MOCK_ROUND_MINUTES);
    // practice snapshot
    const practice = { ...base, practicePrep: { companyBrief: { final_experience: { rounds: [{ type: "dsa", name: "Coding", duration_minutes: 60 }] } } } } as unknown as InterviewSessionRow;
    expect(resolveRound(practice, null, null)!.duration_mins).toBe(MOCK_ROUND_MINUTES);
    // loop node saved before the change, still holding 60 minutes
    const node = { id: "n1", kind: "round", type: "dsa", name: "Coding", durationMinutes: 60, difficulty: "medium", topics: [], position: { x: 0, y: 0 } };
    const loop = { graph: { nodes: [node], edges: [] } } as unknown as LoopRow;
    const booked = { ...base, nodeId: "n1" } as InterviewSessionRow;
    expect(resolveRound(booked, null, loop)!.duration_mins).toBe(MOCK_ROUND_MINUTES);
  });
});

describe("round length in the prep payload", () => {
  const brief = { final_experience: { rounds: [{ id: "r1", type: "dsa", kind: "interview", name: "Coding", duration_minutes: 90 }] } };
  const node = { id: "n1", kind: "round", type: "dsa", name: "Coding", durationMinutes: 45, difficulty: "medium", topics: [], position: { x: 0, y: 0 } };
  const loop = { graph: { nodes: [node], edges: [] } } as unknown as LoopRow;
  const session = (extra: object) => ({ roundType: "dsa", practicePrep: null, nodeId: null, ...extra }) as unknown as InterviewSessionRow;

  it("sends the session's drawn length as duration_mins on the brief, loop-node and practice paths", () => {
    for (const roundMinutes of [30, 35, 40, 45]) {
      expect(resolveRound(session({ roundMinutes }), brief, null)!.duration_mins).toBe(roundMinutes);
      expect(resolveRound(session({ roundMinutes, nodeId: "n1" }), null, loop)!.duration_mins).toBe(roundMinutes);
      const practicePrep = { companyBrief: { final_experience: { rounds: [{ type: "dsa", name: "Coding", duration_minutes: 60 }] } } };
      expect(resolveRound(session({ roundMinutes, practicePrep }), null, null)!.duration_mins).toBe(roundMinutes);
    }
  });

  it("falls back to 45 for a session with no stored length", () => {
    expect(resolveRound(session({ roundMinutes: null }), brief, null)!.duration_mins).toBe(45);
    expect(resolveRound(session({ roundMinutes: null, nodeId: "n1" }), null, loop)!.duration_mins).toBe(45);
  });
});

describe("applying runs", () => {
  it("a completed run with current inputs makes the session ready with its version and briefing", async () => {
    const s = await withRun();
    const current = await env.c.blueprintPrep.assemble(s, "reconcile");
    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_1`, { status: "completed", input_hash: current.input_hash, blueprint_version: 2, briefing: BRIEFING });
    await env.c.blueprintPrep.collect(s);
    expect(await row(s.id)).toMatchObject({ status: "PREP_READY", blueprintVersion: 2, prepInputHash: current.input_hash, prepRunId: null,
      prepBriefing: BRIEFING, prepErrorCode: null, prepRefreshing: false });
  });

  it("a run whose inputs changed meanwhile is superseded and a fresh run starts", async () => {
    const s = await withRun();
    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_1`, { status: "completed", input_hash: "stale", blueprint_version: 1, briefing: BRIEFING });
    env.fetch.on("POST", `${AI}/blueprints/runs`, { run_id: "bpr_2", status: "running", existing: false });
    await env.c.blueprintPrep.collect(s);
    const after = await row(s.id);
    expect(after.status).toBe("PREP_QUEUED");
    expect(after.prepRunId).toBe("bpr_2");
    expect(after.blueprintVersion).toBeNull();
  });

  it("a failed first prep is PREP_FAILED with the run's code; a failed refresh keeps the blueprint", async () => {
    const first = await withRun();
    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_1`, { status: "failed", error: { code: "not_enough_problems" } });
    await env.c.blueprintPrep.collect(first);
    expect(await row(first.id)).toMatchObject({ status: "PREP_FAILED", prepErrorCode: "not_enough_problems", prepRunId: null });

    const ready = await withRun({ status: "PREP_READY", prepRefreshing: true, blueprintVersion: 1, prepBriefing: BRIEFING });
    await env.c.blueprintPrep.collect(ready);
    expect(await row(ready.id)).toMatchObject({ status: "PREP_READY", blueprintVersion: 1, prepRefreshing: false, prepRunId: null, prepBriefing: BRIEFING });
  });

  it("a transient failure is re-run automatically, then surfaces as PREP_FAILED once the budget is spent", async () => {
    const s = await withRun();
    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_1`, { status: "failed", error: { code: "llm_unavailable" } });
    env.fetch.on("POST", `${AI}/blueprints/runs`, { run_id: "bpr_2", status: "running", existing: false }, { times: 3 });
    await env.c.blueprintPrep.collect(s);
    const first = await row(s.id);
    expect(first).toMatchObject({ status: "PREP_QUEUED", prepErrorCode: null, prepRunId: "bpr_2", prepRetryCount: 1 });

    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_2`, { status: "failed", error: { code: "timeout" } });
    await env.c.blueprintPrep.collect(first);
    const second = await row(s.id);
    expect(second).toMatchObject({ status: "PREP_QUEUED", prepRetryCount: 2 });

    // The third transient failure in the hour is the candidate's to retry.
    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_2`, { status: "failed", error: { code: "llm_unavailable" } });
    await env.c.blueprintPrep.collect(second);
    expect(await row(s.id)).toMatchObject({ status: "PREP_FAILED", prepErrorCode: "llm_unavailable", prepRunId: null });
  });

  it("an input problem is never re-run automatically", async () => {
    const s = await withRun();
    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_1`, { status: "failed", error: { code: "round_not_found" } });
    await env.c.blueprintPrep.collect(s);
    expect(await row(s.id)).toMatchObject({ status: "PREP_FAILED", prepErrorCode: "round_not_found", prepRetryCount: 0 });
  });

  it("a run stuck past the timeout is cancelled and started again; with no budget left it fails with `timeout`", async () => {
    const s = await withRun({ prepRunStartedAt: new Date(Date.now() - 60 * 60_000) });
    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_1`, { status: "running", stage: "playbooks" });
    env.fetch.on("POST", `${AI}/blueprints/runs/bpr_1/cancel`, { cancelled: true });
    env.fetch.on("POST", `${AI}/blueprints/runs`, { run_id: "bpr_2", status: "running", existing: false });
    await env.c.blueprintPrep.collect(s);
    expect(await row(s.id)).toMatchObject({ status: "PREP_QUEUED", prepErrorCode: null, prepRunId: "bpr_2", prepRetryCount: 1 });
    expect(env.fetch.callsTo(`${AI}/blueprints/runs/bpr_1/cancel`, "POST")).toHaveLength(1);

    const spent = await withRun({ prepRunStartedAt: new Date(Date.now() - 60 * 60_000), prepRetryCount: 2, prepRetryWindowStart: new Date() });
    await env.c.blueprintPrep.collect(spent);
    expect(await row(spent.id)).toMatchObject({ status: "PREP_FAILED", prepErrorCode: "timeout" });
  });

  it("a run the AI service no longer knows is detached so the next tick restarts it", async () => {
    const s = await withRun();
    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_1`, () => new Response(JSON.stringify({ detail: "unknown run_id" }), { status: 404 }));
    await env.c.blueprintPrep.collect(s);
    expect(await row(s.id)).toMatchObject({ status: "PREP_QUEUED", prepRunId: null });
  });
});

describe("refresh", () => {
  it("re-prepares only when the fingerprint changed", async () => {
    const s = await seedSession(env, user.id, jd, { status: "PREP_READY", blueprintVersion: 1, prepBriefing: BRIEFING });
    const current = await env.c.blueprintPrep.assemble(s, "refresh");
    await env.c.repos.sessions.update(s.id, { prepInputHash: current.input_hash });
    expect(await env.c.blueprintPrep.refreshIfChanged(await row(s.id))).toBe(false);

    await env.c.repos.sessions.update(s.id, { prepInputHash: "older" });
    env.fetch.on("POST", `${AI}/blueprints/runs`, { run_id: "bpr_ref", status: "running", existing: false });
    expect(await env.c.blueprintPrep.refreshIfChanged(await row(s.id))).toBe(true);
    expect(await row(s.id)).toMatchObject({ status: "PREP_READY", prepRunId: "bpr_ref", prepRefreshing: true });
    expect((env.fetch.callsTo(`${AI}/blueprints/runs`, "POST")[0]!.json as { trigger: string }).trigger).toBe("refresh");
  });
});
