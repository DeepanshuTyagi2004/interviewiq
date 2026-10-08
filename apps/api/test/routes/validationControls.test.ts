import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";

const BASE = "/api/v1/admin/validation-controls";
const DEFAULTS = {
  linkedinImportEnabled: true,
  requireSectionReview: true,
};

let env: TestEnv;
let admin: string;
let adminId: string;

beforeAll(async () => {
  env = await createTestEnv();
  const adminUser = await createUser(env, { role: "ADMIN" });
  adminId = adminUser.id;
  admin = await bearer(env, adminUser);
});
afterAll(() => env.close());
beforeEach(async () => {
  env.fetch.reset();
  await env.mongo.validationControls.deleteMany({});
});

describe("admin validation controls", () => {
  it("returns safe defaults when the singleton is absent", async () => {
    expect(await env.mongo.validationControls.countDocuments()).toBe(0);
    const response = await env.http.get(BASE).set("Authorization", admin);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ settings: DEFAULTS, updatedAt: null, updatedBy: null });
  });

  it("is ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.get(BASE).set("Authorization", user)).status).toBe(403);
    expect((await env.http.patch(BASE).set("Authorization", user).send({ linkedinImportEnabled: false })).status).toBe(403);
  });

  it("accepts only strict boolean fields and does not write invalid patches", async () => {
    for (const body of [
      { linkedinImportEnabled: "false" },
      { linkedinImportEnabled: false, unknown: true },
      {}, { requireSectionReview: 0 }, { requireSectionReview: null }, { requireSectionReview: [] },
      { settings: { linkedinImportEnabled: true } },
      // Retired Firecrawl-only controls are unknown fields now.
      { requireCanonicalUrl: false }, { requireExactProviderIdentity: false }, { paidAttemptGuardEnabled: false },
    ]) {
      const response = await env.http.patch(BASE).set("Authorization", admin).send(body);
      expect([response.status, response.body.code]).toEqual([400, "validation_controls_invalid"]);
    }
    expect((await env.http.get(BASE).set("Authorization", admin)).body.settings).toEqual(DEFAULTS);
  });

  it("atomically patches the singleton and records the admin audit fields", async () => {
    const response = await env.http.patch(BASE).set("Authorization", admin).send({ requireSectionReview: false });
    expect(response.status).toBe(200);
    expect(response.body.settings).toEqual({ ...DEFAULTS, requireSectionReview: false });
    expect(typeof response.body.updatedAt).toBe("string");
    const stored = await env.mongo.validationControls.findOne({ _id: "singleton" });
    expect(stored).toMatchObject({ requireSectionReview: false, updatedBy: adminId });
    expect(stored!.lastUpdatedAt.toISOString()).toBe(response.body.updatedAt);
    expect((await env.http.get(BASE).set("Authorization", admin)).body).toEqual(response.body);
    expect(await env.mongo.validationControls.countDocuments()).toBe(1);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("disabled LinkedIn import fails before any extraction call", async () => {
    await env.http.patch(BASE).set("Authorization", admin).send({ linkedinImportEnabled: false });
    const user = await createUser(env);
    const auth = await bearer(env, user);
    const response = await env.http.post("/api/v1/users/me/linkedin/imports").set("Authorization", auth)
      .field("consent", "true").attach("file", Buffer.from("%PDF-1.4 linkedin"), { filename: "Profile.pdf", contentType: "application/pdf" });
    expect([response.status, response.body.code]).toEqual([503, "linkedin_import_disabled"]);
    expect(env.fetch.calls).toHaveLength(0);
    await env.http.patch(BASE).set("Authorization", admin).send({ linkedinImportEnabled: true });
  });

  it("ignores retired Firecrawl-only settings left in a stored singleton", async () => {
    await env.mongo.validationControls.insertOne({ _id: "singleton", linkedinImportEnabled: true, requireSectionReview: true, lastUpdatedAt: new Date(), updatedBy: adminId, paidAttemptGuardEnabled: false } as never);
    const response = await env.http.get(BASE).set("Authorization", admin);
    expect(response.body.settings).toEqual(DEFAULTS);
  });
});
