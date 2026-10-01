import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UpstreamHttpError } from "../../src/lib/http.js";
import { parseCandidateProfileRequest } from "../../src/services/candidateProfileService.js";
import { status } from "../support/fakeFetch.js";
import { createTestEnv, createUser, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";

/**
 * Port of CandidateProfileServiceTest (the async parse poll mapping: a run snapshot →
 * {status, profile?, error?} draft). The AI service is stubbed at the HTTP boundary instead of
 * mocking AiServiceClient, so the real client + mapping run.
 */

const RUN_URL = "http://ai.test/admin/resume/parse/runs/";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

describe("CandidateProfileService.resumeParseRunStatus", () => {
  it("completed run maps the result to a draft profile", async () => {
    env.fetch.on("GET", `${RUN_URL}r1?`, {
      status: "completed",
      result: {
        full_name: "Asha Rao",
        headline: null,
        education: [{ institution: "IIT", degree: "B.Tech", field: "CS", start_year: "2021", end_year: "2025", grade: "8.9" }],
        experience: [{ company: "Acme", title: "Intern", bullets: ["Built X"] }],
        projects: [{ name: "Relay", description: "Mac agent", tech: ["Node.js"], bullets: ["72% fewer tokens"], link: null }],
        skills: ["Python", "SQL"],
        achievements: ["SIH 2024 finalist"],
        links: { github: "https://github.com/asha", leetcode: null, linkedin: null },
      },
    });

    const res = await env.c.candidateProfiles.resumeParseRunStatus("r1");

    expect(res.status).toBe("completed");
    expect(res.error).toBeNull();
    expect(res.profile).not.toBeNull();
    const profile = res.profile!;
    expect(profile.fullName).toBe("Asha Rao");
    expect(profile.projects).toHaveLength(1);
    expect(profile.projects[0]!.name).toBe("Relay");
    expect(profile.projects[0]!.tech).toEqual(["Node.js"]);
    expect(profile.achievements).toEqual(["SIH 2024 finalist"]);
    expect(profile.detectedLinks.github).toBe("https://github.com/asha");

    // Polled from the start (after=0), with the internal key.
    const [call] = env.fetch.callsTo(RUN_URL, "GET");
    expect(call!.url).toBe(`${RUN_URL}r1?after=0`);
    expect(call!.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
  });

  it("running run has no profile", async () => {
    env.fetch.on("GET", `${RUN_URL}r1?`, { status: "running" });
    const res = await env.c.candidateProfiles.resumeParseRunStatus("r1");
    expect(res.status).toBe("running");
    expect(res.profile).toBeNull();
  });

  it("failed run surfaces the message", async () => {
    env.fetch.on("GET", `${RUN_URL}r1?`, { status: "failed", error: { step: "llm_response", message: "all keys cooling" } });
    const res = await env.c.candidateProfiles.resumeParseRunStatus("r1");
    expect(res.status).toBe("failed");
    expect(res.error).toBe("all keys cooling");
    expect(res.profile).toBeNull();
  });

  it("unknown run: upstream 404 maps to failed with an expiry message", async () => {
    env.fetch.on("GET", `${RUN_URL}gone?`, () => status(404, "Not Found"));
    const res = await env.c.candidateProfiles.resumeParseRunStatus("gone");
    expect(res.status).toBe("failed");
    expect(res.error!.toLowerCase()).toContain("expired");
  });

  it("any other upstream error propagates (only 404 is mapped)", async () => {
    env.fetch.on("GET", `${RUN_URL}r1?`, () => status(500, "boom"));
    await expect(env.c.candidateProfiles.resumeParseRunStatus("r1")).rejects.toBeInstanceOf(UpstreamHttpError);
  });
});

describe("CandidateProfileService storage split (Mongo profile doc + Postgres onboarding flag)", () => {
  it("getProfile is null when the user has no profile document", async () => {
    const user = await createUser(env);
    expect(await env.c.candidateProfiles.getProfile(user.id)).toBeNull();
  });

  it("saveProfile writes the doc to candidate_profiles (_id = userId) and complete=true flips the user row", async () => {
    const user = await createUser(env);
    const saved = await env.c.candidateProfiles.saveProfile(
      user.id,
      parseCandidateProfileRequest({
        fullName: "Asha Rao",
        skills: ["Python"],
        detectedLinks: { github: "https://github.com/asha" },
        resumeFilename: "resume.pdf",
        complete: true,
      }),
    );
    expect(saved.fullName).toBe("Asha Rao");
    expect(saved.onboardingComplete).toBe(true);

    const doc = await env.mongo.candidateProfiles.findOne({ _id: user.id });
    expect(doc).not.toBeNull();
    expect(doc!.userId).toBe(user.id);
    expect(doc!.skills).toEqual(["Python"]);
    expect(doc!.detectedLinks).toEqual({ github: "https://github.com/asha", leetcode: null, linkedin: null });
    expect(doc!.resumeFilename).toBe("resume.pdf");
    expect(doc!.resumeParsedAt).toBeInstanceOf(Date);
    expect(doc).not.toHaveProperty("onboardingComplete");

    expect((await env.c.repos.users.findById(user.id))!.onboardingComplete).toBe(true);
    const read = await env.c.candidateProfiles.getProfile(user.id);
    expect(read!.fullName).toBe("Asha Rao");
    expect(read!.onboardingComplete).toBe(true);
  });
});
