import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { json, status } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { AI, aiCalls, PDF_BYTES, sentBytes } from "./helpers.js";

/**
 * Port of AdminResumeParseControllerTest (admin resume-parse observability bench under
 * /api/v1/intelligence/resume). ADMIN-only; forwards to the AI service with the internal key.
 */

let env: TestEnv;
let admin: string;
beforeAll(async () => {
  env = await createTestEnv();
  admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const BASE = "/api/v1/intelligence/resume";

describe("POST /intelligence/resume/parse/run", () => {
  it("startRun_forwardsBytes_andReturnsRunId", async () => {
    env.fetch.on("POST", `${AI}/admin/resume/parse/run`, { run_id: "abc123", status: "running" });
    const res = await env.http
      .post(`${BASE}/parse/run`)
      .set("Authorization", admin)
      .attach("file", PDF_BYTES, { filename: "resume.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run_id: "abc123", status: "running" });

    const [call] = aiCalls(env);
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(`${AI}/admin/resume/parse/run?filename=resume.pdf`);
    expect(call?.headers["content-type"]).toBe("application/pdf");
    expect(call?.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
    expect(sentBytes(call).equals(PDF_BYTES)).toBe(true);
  });

  it("a non-ASCII filename is forwarded URL-encoded", async () => {
    env.fetch.on("POST", `${AI}/admin/resume/parse/run`, { run_id: "r", status: "running" });
    await env.http
      .post(`${BASE}/parse/run`)
      .set("Authorization", admin)
      .attach("file", PDF_BYTES, { filename: "resume final.pdf", contentType: "application/pdf" })
      .expect(200);
    expect(new URL(aiCalls(env)[0]!.url).searchParams.get("filename")).toBe("resume final.pdf");
  });

  it("startRun_nonPdf_isBadRequest", async () => {
    const res = await env.http
      .post(`${BASE}/parse/run`)
      .set("Authorization", admin)
      .attach("file", Buffer.from("hello"), { filename: "resume.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "resume_bad_request", message: "please upload a PDF resume" });
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("startRun_emptyFile_isBadRequest", async () => {
    const res = await env.http
      .post(`${BASE}/parse/run`)
      .set("Authorization", admin)
      .attach("file", Buffer.alloc(0), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "resume_bad_request", message: "the resume file is empty" });
  });

  it("over 6 MB is 413 resume_too_large", async () => {
    const res = await env.http
      .post(`${BASE}/parse/run`)
      .set("Authorization", admin)
      .attach("file", Buffer.alloc(6 * 1024 * 1024 + 1), { filename: "big.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("resume_too_large");
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("an AI failure on start is 502 ai_service_unreachable", async () => {
    env.fetch.on("POST", `${AI}/admin/resume/parse/run`, () => status(500));
    const res = await env.http
      .post(`${BASE}/parse/run`)
      .set("Authorization", admin)
      .attach("file", PDF_BYTES, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ code: "ai_service_unreachable", message: "the intelligence service is not reachable" });
  });
});

describe("GET /intelligence/resume/parse/runs[/:runId]", () => {
  it("runStatus_proxiesSnapshot (forwards ?after)", async () => {
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs/abc123`, { run_id: "abc123", status: "completed", last_seq: 5 });
    const res = await env.http.get(`${BASE}/parse/runs/abc123?after=2`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run_id: "abc123", status: "completed", last_seq: 5 });
    expect(aiCalls(env)[0]?.url).toBe(`${AI}/admin/resume/parse/runs/abc123?after=2`);
  });

  it("after defaults to 0; a non-integer after is 400", async () => {
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs/abc123`, { status: "running" });
    await env.http.get(`${BASE}/parse/runs/abc123`).set("Authorization", admin).expect(200);
    expect(aiCalls(env)[0]?.url).toBe(`${AI}/admin/resume/parse/runs/abc123?after=0`);
    const bad = await env.http.get(`${BASE}/parse/runs/abc123?after=soon`).set("Authorization", admin);
    expect(bad.status).toBe(400);
  });

  it("runStatus_unknownRun_maps404", async () => {
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs/nope`, () => json({ detail: "no such run" }, 404));
    const res = await env.http.get(`${BASE}/parse/runs/nope`).set("Authorization", admin);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "run_not_found", message: "no such resume-parse run" });
  });

  it("list proxies the AI service's run list", async () => {
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs`, { runs: [{ run_id: "a" }, { run_id: "b" }] });
    const res = await env.http.get(`${BASE}/parse/runs`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [{ run_id: "a" }, { run_id: "b" }] });
  });

  it("aiServiceDown_maps502", async () => {
    // no route → connection failure
    const res = await env.http.get(`${BASE}/parse/runs`).set("Authorization", admin);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ai_service_unreachable");
  });

  it("an upstream 5xx on a run snapshot is 502 too", async () => {
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs/abc`, () => status(503));
    const res = await env.http.get(`${BASE}/parse/runs/abc`).set("Authorization", admin);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ai_service_unreachable");
  });
});

describe("security", () => {
  it("ADMIN-only: a regular user is 403, no token is 401", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.get(`${BASE}/parse/runs`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.get(`${BASE}/parse/runs`)).status).toBe(401);
    const upload = await env.http
      .post(`${BASE}/parse/run`)
      .set("Authorization", user)
      .attach("file", PDF_BYTES, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(403);
    expect(aiCalls(env)).toHaveLength(0);
  });
});
