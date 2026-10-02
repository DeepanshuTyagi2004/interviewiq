import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { json, status, text } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { AI, aiCalls, PDF_BYTES, sentBytes } from "./helpers.js";

/**
 * Port of CandidateProfileControllerTest (onboarding resume parse + candidate-profile read/upsert
 * under /api/v1/users/me). Drives the real service + Mongo; only the AI service is stubbed.
 */

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const PARSE = "/api/v1/users/me/resume/parse";
const PROFILE = "/api/v1/users/me/candidate-profile";
const UNAVAILABLE = "Resume parsing is temporarily unavailable. Please try again or enter your details manually.";

/** What the AI service's /resumes/parse returns (snake_case). */
const PARSED = {
  full_name: "Asha Rao",
  email: "asha@example.com",
  phone: "+91 90000 00000",
  location: "Delhi",
  headline: "Aspiring SDE",
  education: [{ institution: "IIT", degree: "B.Tech", field: "CS", start_year: "2021", end_year: "2025", grade: "8.9" }],
  experience: [{ company: "Acme", title: "Intern", start_date: "2024", end_date: "2024", location: "Remote", bullets: ["Built X"] }],
  projects: [
    {
      name: "Relay",
      description: "Mac automation agent",
      tech: ["Node.js", "WebSocket"],
      bullets: ["Built a real-time automation agent"],
      link: "https://github.com/asha/relay",
    },
  ],
  skills: ["Python", "SQL"],
  achievements: ["Smart India Hackathon 2024 finalist"],
  links: { github: "https://github.com/asha", leetcode: null, linkedin: null },
  some_future_field: { ignored: true },
};

/** The camelCase draft the endpoint returns for PARSED. */
const DRAFT = {
  fullName: "Asha Rao",
  email: "asha@example.com",
  phone: "+91 90000 00000",
  location: "Delhi",
  headline: "Aspiring SDE",
  targetRole: null,
  targetJdId: null,
  education: [{ institution: "IIT", degree: "B.Tech", field: "CS", startYear: "2021", endYear: "2025", grade: "8.9" }],
  experience: [{ company: "Acme", title: "Intern", startDate: "2024", endDate: "2024", location: "Remote", bullets: ["Built X"] }],
  projects: [
    {
      name: "Relay",
      description: "Mac automation agent",
      tech: ["Node.js", "WebSocket"],
      bullets: ["Built a real-time automation agent"],
      link: "https://github.com/asha/relay",
    },
  ],
  skills: ["Python", "SQL"],
  achievements: ["Smart India Hackathon 2024 finalist"],
  detectedLinks: { github: "https://github.com/asha", leetcode: null, linkedin: null },
  resumeFilename: "resume.pdf",
  resumeParsedAt: null,
  onboardingComplete: false,
};

async function auth(): Promise<string> {
  return bearer(env, await createUser(env));
}

describe("POST /users/me/resume/parse (synchronous parse)", () => {
  it("parseResume_returnsDraft: forwards the PDF bytes and maps the snake_case result to the draft", async () => {
    env.fetch.on("POST", `${AI}/resumes/parse`, PARSED);
    const res = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", PDF_BYTES, { filename: "resume.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(DRAFT);
    expect(res.body.score).toBeUndefined();

    const [call] = aiCalls(env);
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(`${AI}/resumes/parse`);
    expect(call?.headers["content-type"]).toBe("application/pdf");
    expect(call?.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
    expect(sentBytes(call).equals(PDF_BYTES)).toBe(true);
  });

  it("missing arrays/links in the AI result become empty lists / null links", async () => {
    env.fetch.on("POST", `${AI}/resumes/parse`, { full_name: "Only Name", experience: [{ company: "X" }] });
    const res = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", PDF_BYTES, { filename: "cv.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe("Only Name");
    expect(res.body.education).toEqual([]);
    expect(res.body.projects).toEqual([]);
    expect(res.body.skills).toEqual([]);
    expect(res.body.achievements).toEqual([]);
    expect(res.body.experience).toEqual([{ company: "X", title: null, startDate: null, endDate: null, location: null, bullets: [] }]);
    expect(res.body.detectedLinks).toEqual({ github: null, leetcode: null, linkedin: null });
    expect(res.body.resumeFilename).toBe("cv.pdf");
  });

  it("parseResume_nonPdf_isBadRequest (and nothing is sent upstream)", async () => {
    const res = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", Buffer.from("hello"), { filename: "resume.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("resume_bad_request");
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("accepts a PDF identified by extension only, or by content-type only", async () => {
    env.fetch.on("POST", `${AI}/resumes/parse`, PARSED);
    const byExt = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", PDF_BYTES, { filename: "My Resume.PDF", contentType: "application/octet-stream" });
    expect(byExt.status).toBe(200);
    const byType = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", PDF_BYTES, { filename: "resume", contentType: "application/pdf" });
    expect(byType.status).toBe(200);
  });

  it("an empty file is 400 resume_bad_request", async () => {
    const res = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", Buffer.alloc(0), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("resume_bad_request");
  });

  it("a request without the file part is 400", async () => {
    const res = await env.http.post(PARSE).set("Authorization", await auth()).field("other", "x");
    expect(res.status).toBe(400);
    expect(typeof res.body.code).toBe("string");
  });

  it("a file over 6 MB is 413 resume_too_large (authoritative cap)", async () => {
    const res = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", Buffer.alloc(6 * 1024 * 1024 + 1), { filename: "big.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ code: "resume_too_large", message: "The resume must be 6 MB or smaller." });
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("a file over the multipart backstop is also 413 resume_too_large", async () => {
    const res = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", Buffer.alloc(9 * 1024 * 1024), { filename: "huge.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("resume_too_large");
  });

  it("parseResume_unreadablePdf_maps422", async () => {
    env.fetch.on("POST", `${AI}/resumes/parse`, () => json({ detail: "no text" }, 422));
    const res = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", Buffer.from("%PDF-1.4 scanned"), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      code: "resume_unreadable",
      message: "We couldn't read that PDF — it may be a scanned image. Please enter your details manually.",
    });
  });

  it.each([
    ["another upstream 4xx", () => json({ detail: "bad" }, 400)],
    ["an upstream 5xx", () => status(503)],
    ["a 2xx body that is not JSON", () => text("<html>oops</html>")],
    ["an empty 2xx body", () => text("")],
  ])("%s degrades to 502 resume_parse_failed", async (_label, respond) => {
    env.fetch.on("POST", `${AI}/resumes/parse`, respond);
    const res = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", PDF_BYTES, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ code: "resume_parse_failed", message: UNAVAILABLE });
  });

  it("an unreachable AI service is 502 resume_parse_failed", async () => {
    // no route registered → transport failure
    const res = await env.http
      .post(PARSE)
      .set("Authorization", await auth())
      .attach("file", PDF_BYTES, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("resume_parse_failed");
  });

  it("requires a JWT", async () => {
    const res = await env.http.post(PARSE).attach("file", PDF_BYTES, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(401);
  });
});

describe("POST /users/me/resume/parse/start + GET /resume/parse/runs/:runId (fire-and-poll)", () => {
  it("start returns the AI service's {run_id, status} and forwards the filename", async () => {
    env.fetch.on("POST", `${AI}/admin/resume/parse/run`, { run_id: "run-1", status: "running" });
    const res = await env.http
      .post(`${PARSE}/start`)
      .set("Authorization", await auth())
      .attach("file", PDF_BYTES, { filename: "resume 2025.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run_id: "run-1", status: "running" });
    const [call] = aiCalls(env);
    expect(new URL(call!.url).searchParams.get("filename")).toBe("resume 2025.pdf");
    expect(call?.headers["content-type"]).toBe("application/pdf");
    expect(sentBytes(call).equals(PDF_BYTES)).toBe(true);
  });

  it("start validates the upload like the sync parse", async () => {
    const res = await env.http
      .post(`${PARSE}/start`)
      .set("Authorization", await auth())
      .attach("file", Buffer.from("hello"), { filename: "resume.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("resume_bad_request");
  });

  it("start: AI service failure is 502 resume_parse_failed", async () => {
    env.fetch.on("POST", `${AI}/admin/resume/parse/run`, () => status(500));
    const res = await env.http
      .post(`${PARSE}/start`)
      .set("Authorization", await auth())
      .attach("file", PDF_BYTES, { filename: "resume.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("resume_parse_failed");
  });

  it("poll: running → {status: running, profile: null, error: null}", async () => {
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs/run-1`, { run_id: "run-1", status: "running" });
    const res = await env.http.get(`${PARSE}/runs/run-1`).set("Authorization", await auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "running", profile: null, error: null });
    expect(aiCalls(env)[0]?.url).toBe(`${AI}/admin/resume/parse/runs/run-1?after=0`);
  });

  it("poll: completed → the mapped draft (no filename — the client keeps it)", async () => {
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs/run-2`, { run_id: "run-2", status: "completed", result: PARSED });
    const res = await env.http.get(`${PARSE}/runs/run-2`).set("Authorization", await auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "completed", profile: { ...DRAFT, resumeFilename: null }, error: null });
  });

  it("poll: failed carries the AI error message, or a default one", async () => {
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs/run-3`, { status: "failed", error: { message: "LLM timed out" } });
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs/run-4`, { status: "failed" });
    const a = await env.http.get(`${PARSE}/runs/run-3`).set("Authorization", await auth());
    expect(a.body).toEqual({ status: "failed", profile: null, error: "LLM timed out" });
    const b = await env.http.get(`${PARSE}/runs/run-4`).set("Authorization", await auth());
    expect(b.body).toEqual({
      status: "failed",
      profile: null,
      error: "We couldn't parse that resume. Please try again or enter your details manually.",
    });
  });

  it("poll: an unknown/expired run (upstream 404) is a 200 failed status, not an error", async () => {
    env.fetch.on("GET", `${AI}/admin/resume/parse/runs/gone`, () => json({ detail: "not found" }, 404));
    const res = await env.http.get(`${PARSE}/runs/gone`).set("Authorization", await auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "failed", profile: null, error: "This parse expired — please upload the resume again." });
  });

  it("poll: AI service down is 502 resume_parse_failed", async () => {
    const res = await env.http.get(`${PARSE}/runs/run-x`).set("Authorization", await auth());
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("resume_parse_failed");
  });
});

describe("GET/PUT /users/me/candidate-profile", () => {
  const saveBody = {
    fullName: "Asha Rao",
    email: "asha@example.com",
    phone: null,
    location: "Delhi",
    headline: null,
    targetRole: "SDE",
    education: [{ institution: "IIT", degree: "B.Tech", field: "CS", startYear: "2021", endYear: "2025", grade: "8.9", extra: "dropped" }],
    experience: [],
    projects: [],
    skills: ["Python"],
    achievements: [],
    detectedLinks: { github: null, leetcode: null, linkedin: null },
    resumeFilename: "resume.pdf",
    complete: true,
  };

  it("getCandidateProfile_whenNone_returnsNoContent", async () => {
    const res = await env.http.get(PROFILE).set("Authorization", await auth());
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("saveCandidateProfile_returnsSaved: complete=true finishes onboarding", async () => {
    const user = await createUser(env);
    const authz = await bearer(env, user);
    const res = await env.http.put(PROFILE).set("Authorization", authz).send(saveBody);
    expect(res.status).toBe(200);
    expect(res.body.onboardingComplete).toBe(true);
    expect(res.body.fullName).toBe("Asha Rao");
    expect(res.body.education).toEqual([{ institution: "IIT", degree: "B.Tech", field: "CS", startYear: "2021", endYear: "2025", grade: "8.9" }]);
    expect(res.body.resumeFilename).toBe("resume.pdf");
    expect(typeof res.body.resumeParsedAt).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.resumeParsedAt))).toBe(false);

    // The onboarding flag lives on the user and gates app entry.
    const me = await env.http.get("/api/v1/users/me").set("Authorization", authz);
    expect(me.body.onboardingComplete).toBe(true);
  });

  it("getCandidateProfile_returnsProfile (full wire shape, descriptive only)", async () => {
    const user = await createUser(env);
    const authz = await bearer(env, user);
    const saved = await env.http.put(PROFILE).set("Authorization", authz).send(saveBody);
    const res = await env.http.get(PROFILE).set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      fullName: "Asha Rao",
      email: "asha@example.com",
      phone: null,
      location: "Delhi",
      headline: null,
      targetRole: "SDE",
      targetJdId: null,
      education: [{ institution: "IIT", degree: "B.Tech", field: "CS", startYear: "2021", endYear: "2025", grade: "8.9" }],
      experience: [],
      projects: [],
      skills: ["Python"],
      achievements: [],
      detectedLinks: { github: null, leetcode: null, linkedin: null },
      resumeFilename: "resume.pdf",
      resumeParsedAt: saved.body.resumeParsedAt,
      onboardingComplete: true,
    });
    // hard rule: descriptive only, no scoring
    expect(res.body.score).toBeUndefined();
  });

  it("stores the chosen target JD id alongside its label, and clears it with null", async () => {
    const authz = await auth();
    const jdId = "6f1c2b9a-3d4e-4f50-8a1b-2c3d4e5f6a7b";
    const saved = await env.http.put(PROFILE).set("Authorization", authz).send({ ...saveBody, targetRole: "Meesho · SDE I", targetJdId: jdId });
    expect(saved.status).toBe(200);
    expect(saved.body.targetJdId).toBe(jdId);
    expect((await env.http.get(PROFILE).set("Authorization", authz)).body.targetJdId).toBe(jdId);

    const cleared = await env.http.put(PROFILE).set("Authorization", authz).send({ ...saveBody, targetJdId: null });
    expect(cleared.body.targetJdId).toBeNull();
  });

  it("a malformed target JD id is 400 invalid_target_jd and nothing is saved", async () => {
    const authz = await auth();
    const res = await env.http.put(PROFILE).set("Authorization", authz).send({ ...saveBody, targetJdId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_target_jd");
    expect((await env.http.get(PROFILE).set("Authorization", authz)).status).toBe(204);
  });

  it("saving without complete leaves onboarding incomplete; nulls default to empty lists", async () => {
    const user = await createUser(env);
    const res = await env.http
      .put(PROFILE)
      .set("Authorization", await bearer(env, user))
      .send({ fullName: "Ravi", education: null, skills: null, detectedLinks: null });
    expect(res.status).toBe(200);
    expect(res.body.onboardingComplete).toBe(false);
    expect(res.body.education).toEqual([]);
    expect(res.body.skills).toEqual([]);
    expect(res.body.detectedLinks).toEqual({ github: null, leetcode: null, linkedin: null });
    expect(res.body.resumeFilename).toBeNull();
    expect(res.body.resumeParsedAt).toBeNull();
  });

  it("resumeParsedAt is stamped only when the resume filename changes", async () => {
    const user = await createUser(env);
    const authz = await bearer(env, user);
    const first = await env.http.put(PROFILE).set("Authorization", authz).send({ ...saveBody, complete: false });
    const stamp = first.body.resumeParsedAt as string;
    expect(stamp).toBeTruthy();

    const same = await env.http.put(PROFILE).set("Authorization", authz).send({ ...saveBody, fullName: "Asha R.", complete: false });
    expect(same.body.resumeParsedAt).toBe(stamp);
    expect(same.body.fullName).toBe("Asha R.");

    // Omitting the filename keeps the stored one.
    const omitted = await env.http.put(PROFILE).set("Authorization", authz).send({ fullName: "Asha" });
    expect(omitted.body.resumeFilename).toBe("resume.pdf");
    expect(omitted.body.resumeParsedAt).toBe(stamp);

    await new Promise((r) => setTimeout(r, 5));
    const changed = await env.http.put(PROFILE).set("Authorization", authz).send({ ...saveBody, resumeFilename: "resume-v2.pdf" });
    expect(changed.body.resumeFilename).toBe("resume-v2.pdf");
    expect(Date.parse(changed.body.resumeParsedAt)).toBeGreaterThan(Date.parse(stamp));
  });

  it("a PUT without a request body is rejected (Spring: required @RequestBody → 400) and does not wipe the profile", async () => {
    const user = await createUser(env);
    const authz = await bearer(env, user);
    await env.http.put(PROFILE).set("Authorization", authz).send(saveBody);

    const res = await env.http.put(PROFILE).set("Authorization", authz);
    expect(res.status).toBe(400);

    // Same for a JSON content-type with an empty body ("Required request body is missing" in Spring).
    const empty = await env.http.put(PROFILE).set("Authorization", authz).set("Content-Type", "application/json").send("");
    expect(empty.status).toBe(400);

    const after = await env.http.get(PROFILE).set("Authorization", authz);
    expect(after.body.fullName).toBe("Asha Rao");
  });

  it("malformed JSON is 400 with the ApiError envelope", async () => {
    const res = await env.http
      .put(PROFILE)
      .set("Authorization", await auth())
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("getCandidateProfile_withoutJwt_isUnauthorized", async () => {
    expect((await env.http.get(PROFILE)).status).toBe(401);
    expect((await env.http.put(PROFILE).send(saveBody)).status).toBe(401);
  });
});
