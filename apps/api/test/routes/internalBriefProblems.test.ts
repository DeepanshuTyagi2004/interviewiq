import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { manualJdBriefs } from "../../src/db/pg/schema.js";
import { enrichmentBrief } from "../../src/domain/enrichment.js";
import { createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { seedCompany, seedJd } from "./helpers.js";

/** /internal/brief-problems: the named problems in published briefs, for the AI service's problem bank. */

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
  await seedCompany(env, "amazon", "Amazon");
  const company = (await env.c.repos.companies.findBySlug("amazon"))!;
  const jd = await seedJd(env, { company: "amazon", level: "sde2", title: "SDE-2" });
  const roleId = randomUUID();
  const brief = enrichmentBrief("amazon", {
    id: roleId, jdId: jd.id, title: "SDE-2", role: "software-engineer", level: "sde2", specialization: "backend", description: "d", techStack: ["Java"],
    yoeMin: null, yoeMax: null, ctcMinLpa: null, ctcMaxLpa: null, sourceUrls: ["https://x.test"], verified: true,
    rounds: [
      { id: randomUUID(), name: "LLD", type: "lld", durationMinutes: 60, difficulty: "medium", topics: ["OOP"], questions: ["Design a parking lot"], guidance: "", sourceUrls: ["https://x.test"], verified: true },
      { id: randomUUID(), name: "HR", type: "hiring-manager", durationMinutes: 30, difficulty: "easy", topics: ["Fit"], questions: [], guidance: "", sourceUrls: ["https://x.test"], verified: true },
    ],
  }, { overview: "o", culture: "", benefits: "", sourceUrls: ["https://x.test"], verified: true }, 1, new Date("2026-10-07T00:00:00Z"));
  await env.db.insert(manualJdBriefs).values({ jdId: jd.id, companyId: company.id, roleId, brief });
});
afterAll(() => env.close());

describe("GET /internal/brief-problems", () => {
  it("needs the internal key and returns only rounds that carry problems", async () => {
    expect((await env.http.get("/api/v1/internal/brief-problems")).status).toBe(401);
    const res = await env.http.get("/api/v1/internal/brief-problems").set("x-internal-api-key", TEST_INTERNAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ briefs: [{ company: "amazon", final_experience: { rounds: [{ type: "lld", difficulty: "medium", topics: ["OOP"], problems: ["Design a parking lot"] }] } }] });
  });
});
