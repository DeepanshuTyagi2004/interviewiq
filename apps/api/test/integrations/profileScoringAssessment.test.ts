import { beforeEach, describe, expect, it } from "vitest";
import { AiServiceClient } from "../../src/integrations/aiService/client.js";
import type { ProfileScoringAssessmentRequest } from "../../src/integrations/aiService/types.js";
import { UpstreamHttpError, UpstreamMalformedError, UpstreamTransportError } from "../../src/lib/http.js";
import { silentLogger } from "../../src/lib/logger.js";
import { FakeFetch, json, text } from "../support/fakeFetch.js";

const URL = "http://ai.test/profile-scoring/assess";
const request = (): ProfileScoringAssessmentRequest => ({
  userContext: { declaredLevel: "sde2", targetRole: "Backend engineer" },
  projects: [{ title: "Cache", excerpts: ["Reduced latency by 30%"] }],
  experience: [{ title: "Engineer", excerpts: ["Owned the API rollout"] }],
  internships: [{ title: "Intern", excerpts: ["Implemented a test harness"] }],
  requestedFeatures: ["implementation", { key: "impact", description: "Measured outcomes" }],
});
const response = () => ({
  assessments: [
    { feature: "implementation", value: 60, rationale: "Reported delivery", evidenceExcerpts: ["Owned the API rollout"], evidenceType: "INFERRED" },
    { feature: "impact", value: 70, rationale: "Reported improvement", evidenceExcerpts: ["Reduced latency by 30%"], evidenceType: "INFERRED" },
  ],
  provider: "fake", model: "fake-model", generatedAt: "2026-10-05T10:00:00Z",
  algorithmVersion: "profile-scoring-assessment-v1", promptVersion: "profile-scoring-assessment-prompt-v5",
});

describe("LLM-assisted profile assessment boundary", () => {
  let fake: FakeFetch;
  let client: AiServiceClient;
  beforeEach(() => {
    fake = new FakeFetch();
    client = new AiServiceClient("http://ai.test", "private-internal-key", fake.fetch, silentLogger());
    fake.on("POST", URL, response());
  });

  it("posts only minimized evidence with the internal key and returns validated per-feature provenance", async () => {
    await expect(client.assessProfileScoring(request())).resolves.toEqual(response());
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.headers["x-internal-api-key"]).toBe("private-internal-key");
    expect(fake.calls[0]!.headers["content-type"]).toBe("application/json");
    expect(fake.calls[0]!.json).toMatchObject({
      userContext: { declaredLevel: "sde2" },
      requestedFeatures: [{ key: "implementation" }, { key: "impact" }],
    });
  });

  it.each([-1, 101, NaN, Infinity, "60", true])("rejects non-numeric/out-of-range value %s", async (value) => {
    const result = response();
    Object.assign(result.assessments[0]!, { value });
    fake.on("POST", URL, result);
    await expect(client.assessProfileScoring(request())).rejects.toBeInstanceOf(UpstreamMalformedError);
  });

  it.each([
    (r: ReturnType<typeof response>) => Object.assign(r, { overallScore: 95 }),
    (r: ReturnType<typeof response>) => Object.assign(r.assessments[0]!, { overallScore: 95 }),
    (r: ReturnType<typeof response>) => Object.assign(r.assessments[0]!, { evidenceType: "VERIFIED" }),
    (r: ReturnType<typeof response>) => Object.assign(r.assessments[0]!, { confidence: 45 }),
    (r: ReturnType<typeof response>) => Object.assign(r.assessments[0]!, { feature: "ownership" }),
    (r: ReturnType<typeof response>) => Object.assign(r.assessments[0]!, { feature: "impact" }),
    (r: ReturnType<typeof response>) => Object.assign(r.assessments[0]!, { evidenceExcerpts: ["Invented quote"] }),
    (r: ReturnType<typeof response>) => Object.assign(r.assessments[0]!, { evidenceExcerpts: [] }),
    (r: ReturnType<typeof response>) => Object.assign(r, { generatedAt: "invalid" }),
    (r: ReturnType<typeof response>) => r.assessments.pop(),
  ])("rejects malformed response decisions/attribution", async (mutate) => {
    const result = response();
    mutate(result);
    fake.on("POST", URL, result);
    await expect(client.assessProfileScoring(request())).rejects.toBeInstanceOf(UpstreamMalformedError);
  });

  it.each([
    { userContext: { email: "private@example.test" } },
    { rawResume: "private-input-secret" },
    { requestedFeatures: ["overall_score"] },
    { requestedFeatures: ["impact", "impact"] },
    { requestedFeatures: Array.from({ length: 25 }, (_, i) => `feature${i}`) },
    { projects: [{ title: "x", excerpts: ["x".repeat(801)] }] },
    { projects: Array.from({ length: 21 }, () => ({ title: "x" })) },
    { projects: Array.from({ length: 10 }, () => ({ title: "x", excerpts: Array(8).fill("x".repeat(800)) })) },
  ])("rejects private/oversized/duplicate request before transport", async (patch) => {
    await expect(client.assessProfileScoring({ ...request(), ...patch } as ProfileScoringAssessmentRequest)).rejects.toThrow("Invalid minimized");
    expect(fake.calls).toHaveLength(0);
  });

  it("returns safe errors even when upstream reflects keys or transport exceptions contain secrets", async () => {
    fake.on("POST", URL, () => json({ detail: "private-upstream-secret" }, 422));
    const err: unknown = await client.assessProfileScoring(request()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamHttpError);
    expect((err as UpstreamHttpError).status).toBe(422);
    expect((err as UpstreamHttpError).responseBody).toBe("");
    expect(String(err)).not.toContain("private-upstream-secret");
    fake.on("POST", URL, () => { throw new Error("private-transport-secret"); });
    const transport: unknown = await client.assessProfileScoring(request()).catch((e: unknown) => e);
    expect(transport).toBeInstanceOf(UpstreamTransportError);
    expect((transport as Error).cause).toBeUndefined();
    expect(String(transport)).not.toContain("private-transport-secret");
    fake.on("POST", URL, () => text("private-invalid-json-secret"));
    await expect(client.assessProfileScoring(request())).rejects.toThrow("returned invalid JSON");
  });
});
