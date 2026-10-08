import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalLinkedInUrl } from "../../src/domain/linkedinImport.js";
import { sourceFileName } from "../../src/services/linkedinImport.js";
import { bearer, createTestEnv, createUser, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { json } from "../support/fakeFetch.js";

const BASE = "/api/v1/users/me/linkedin";
const URL = "https://www.linkedin.com/in/example-engineer/";
const AI = "http://ai.test/linkedin/parse";
const PDF = Buffer.from("%PDF-1.4\nLinkedIn Save to PDF fixture");
let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(() => env.close());
beforeEach(() => { env.fetch.reset(); vi.restoreAllMocks(); });

function extraction() {
  return {
    method: "pdf", sourceUrl: URL, provider: null, retrievedAt: null, partial: true,
    profile: { headline: "Software engineer", about: "Builds developer tools", skills: ["Python", "SQL"], achievements: ["Hackathon finalist"],
      education: [{ institution: "Example University", degree: "BTech", field: "CS", startYear: "2020", endYear: "2024", grade: null }],
      experience: [{ company: "Example Co", title: "Engineer", startDate: "2024", endDate: "Present", location: "Remote", bullets: ["Built tools"] }],
      projects: [{ name: "Compiler", description: "A learning compiler", tech: [], bullets: [], link: null }],
      level: "principal", fullName: "Must not import", email: "private@example.invalid", verification: "verified" },
    sections: [
      { key: "headline", label: "Headline", entries: ["Software engineer"], sourceFile: null },
      { key: "about", label: "About", entries: ["Builds developer tools"], sourceFile: null },
      { key: "skills", label: "Skills", entries: ["Python", "SQL"], sourceFile: null },
      { key: "experience", label: "Experience", entries: ["Engineer · Example Co · 2024 · Present"], sourceFile: null },
      { key: "education", label: "Education", entries: ["Example University · BTech"], sourceFile: null },
      { key: "projects", label: "Projects", entries: ["Compiler"], sourceFile: null },
      { key: "achievements", label: "Achievements", entries: ["Hackathon finalist"], sourceFile: null },
    ],
    warnings: ["This is a snapshot of the PDF you uploaded; it does not update when your LinkedIn profile changes."],
    provenance: [
      { section: "skills", path: "profile.skills.0", file: null, quote: "Python" },
      { section: "skills", path: "profile.skills.1", file: null, quote: "SQL" },
      { section: "about", path: "profile.about", file: null, quote: "Builds developer tools" },
      { section: "headline", path: "profile.headline", file: null, quote: "Software engineer" },
      { section: "experience", path: "profile.experience.0.title", file: null, quote: "Engineer" },
    ],
  };
}

async function owner() {
  const user = await createUser(env, { onboardingComplete: true });
  return { user, auth: await bearer(env, user) };
}
function upload(auth: string, options: { consent?: string | null; file?: Buffer | null; filename?: string } = {}) {
  let request = env.http.post(`${BASE}/imports`).set("Authorization", auth);
  if (options.consent !== null) request = request.field("consent", options.consent ?? "true");
  if (options.file !== null) request = request.attach("file", options.file ?? PDF, { filename: options.filename ?? "Profile.pdf", contentType: "application/pdf" });
  return request;
}
async function draft(auth: string) {
  env.fetch.on("POST", AI, extraction());
  const response = await upload(auth);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}
async function saveOwnedProfile(userId: string) {
  const p = extraction().profile;
  return env.c.repos.candidateProfiles.save({ userId, level: "sde2", fullName: "Human name", email: "human@example.invalid", phone: "555", location: "Human location",
    headline: "Human headline", targetRole: "Human target", targetJdId: "00000000-0000-4000-8000-000000000001",
    education: p.education, experience: [{ ...p.experience[0]!, startDate: "2023", bullets: ["Human bullet"] }], projects: p.projects,
    skills: ["python"], achievements: ["Hackathon finalist"], detectedLinks: { github: "https://github.com/example", linkedin: "https://www.linkedin.com/in/human/", leetcode: null },
    resumeFilename: "human.pdf", resumeParsedAt: new Date("2026-01-01"),
  });
}

describe("consented LinkedIn PDF intake", () => {
  it("requires auth, explicit consent, a PDF file and multipart; rejects before any extraction", async () => {
    for (const method of ["get", "post", "delete"] as const) expect((await env.http[method](BASE)).status).toBe(401);
    expect((await env.http.post(`${BASE}/imports`).field("consent", "true").attach("file", PDF, "Profile.pdf")).status).toBe(401);
    const { auth } = await owner();
    expect([(await upload(auth, { consent: null })).body.code]).toEqual(["linkedin_consent_required"]);
    expect([(await upload(auth, { consent: "false" })).body.code]).toEqual(["linkedin_consent_required"]);
    expect([(await upload(auth, { file: null })).body.code]).toEqual(["linkedin_pdf_missing"]);
    const zip = await upload(auth, { file: Buffer.from("PK\u0003\u0004 zip"), filename: "profile.pdf" });
    expect([zip.status, zip.body.code]).toEqual([415, "linkedin_pdf_unsupported_media"]);
    const jsonBody = await env.http.post(`${BASE}/imports`).set("Authorization", auth).send({ url: URL, consent: true });
    expect([jsonBody.status, jsonBody.body.code]).toEqual([415, "linkedin_import_unsupported_media"]);
    const oversize = await upload(auth, { file: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]) });
    expect([oversize.status, oversize.body.code]).toEqual([413, "linkedin_pdf_too_large"]);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("forwards the raw PDF to the internal endpoint and returns a private draft with null level and no contacts", async () => {
    const { user, auth } = await owner();
    env.fetch.on("POST", AI, extraction());
    const response = await upload(auth);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({ method: "pdf", sourceUrl: URL, provider: null, retrievedAt: null, profileRevision: null, profile: { level: null, fullName: null, email: null } });
    expect(response.body.sections.every((s: { sourceFile: string }) => s.sourceFile === "Profile.pdf")).toBe(true);
    expect(Date.parse(response.body.expiresAt) - Date.parse(response.body.createdAt)).toBe(24 * 60 * 60 * 1000);
    const call = env.fetch.calls[0]!;
    expect(call).toMatchObject({ url: AI, headers: { "x-internal-api-key": TEST_INTERNAL_KEY, "content-type": "application/pdf" } });
    expect(Buffer.from(call.body as Uint8Array).equals(PDF)).toBe(true);
    expect(await env.c.repos.candidateProfiles.findByUserId(user.id)).toBeNull();
    expect(await env.c.repos.fragments.findByUserId(user.id)).toHaveLength(0);
    const stored = JSON.stringify(await env.c.repos.linkedinImports.export(user.id));
    expect(stored).not.toContain("private@example.invalid");
    expect(stored).not.toContain("Save to PDF fixture");
    expect((await env.c.repos.linkedinImports.export(user.id))[0]!.provenance.every((p) => p.file === "Profile.pdf")).toBe(true);
  });

  it("keeps display filenames safe and drops an unsafe profile link found in the PDF", async () => {
    expect(sourceFileName(null)).toBe("LinkedIn.pdf");
    expect(sourceFileName("  ")).toBe("LinkedIn.pdf");
    expect(sourceFileName("a/b\\c\u0000\u0007.pdf")).toBe("abc.pdf");
    expect(sourceFileName(`${"x".repeat(200)}.pdf`)).toHaveLength(120);
    expect(sourceFileName(`${"x".repeat(200)}.pdf`).endsWith(".pdf")).toBe(true);
    const { auth } = await owner();
    env.fetch.on("POST", AI, { ...extraction(), sourceUrl: "https://www.linkedin.com.evil.test/in/example/" });
    const response = await upload(auth);
    expect(response.status).toBe(201);
    expect(response.body.sourceUrl).toBeNull();
  });

  it.each([
    [422, "linkedin_pdf_unrecognized", 422],
    [422, "linkedin_pdf_unreadable", 422],
    [422, "linkedin_pdf_no_claims", 422],
    [413, "linkedin_pdf_too_large", 413],
  ])("maps ai-service %i %s to an actionable API error without its payload", async (status, code, expected) => {
    const { auth } = await owner();
    env.fetch.on("POST", AI, () => json({ detail: { code, message: "private provider payload" } }, status));
    const response = await upload(auth);
    expect([response.status, response.body.code]).toEqual([expected, code]);
    expect(JSON.stringify(response.body)).not.toContain("private provider");
  });

  it("preserves an existing source when extraction fails or returns an unsupported shape", async () => {
    const { user, auth } = await owner();
    const d = await draft(auth);
    await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["skills"] });
    const before = await env.c.repos.fragments.findByUserId(user.id);
    for (const respond of [
      () => json({ detail: { message: "private provider secret" } }, 503),
      () => json({ detail: { code: "something_new" } }, 422),
      () => json({ ...extraction(), method: "url", provider: "firecrawl" }),
      () => json({ ...extraction(), provenance: [{ section: "patents", path: "sections.patents.0", file: null, quote: "x" }] }),
    ]) {
      env.fetch.reset(); env.fetch.on("POST", AI, respond);
      const response = await upload(auth);
      expect([response.status, response.body.code]).toEqual([503, "linkedin_extractor_unavailable"]);
      expect(JSON.stringify(response.body)).not.toContain("private provider");
    }
    expect(await env.c.repos.fragments.findByUserId(user.id)).toEqual(before);
  });

  it("allows a manual retry after a failure and stores no paid-attempt receipts", async () => {
    const { user, auth } = await owner();
    env.fetch.on("POST", AI, () => json({}, 503));
    expect((await upload(auth)).status).toBe(503);
    env.fetch.on("POST", AI, extraction());
    expect((await upload(auth)).status).toBe(201);
    expect(env.fetch.calls).toHaveLength(2);
    expect(await env.mongo.linkedinImportLocks.countDocuments({ userId: user.id })).toBe(0);
  });

  it("holds no mutation lease during extraction and bounds unconfirmed drafts per owner before dispatch", async () => {
    const { user, auth } = await owner();
    let entered!: () => void, release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; }), started = new Promise<void>((r) => { entered = r; });
    env.fetch.on("POST", AI, async () => { entered(); await blocked; return json(extraction()); });
    const pending = env.c.linkedin.create(user.id, { bytes: PDF, filename: "Profile.pdf" });
    await started;
    expect(await env.mongo.linkedinImportLocks.findOne({ _id: user.id })).toBeNull();
    release(); await pending;
    env.fetch.reset();
    await draft(auth); await draft(auth);
    const count = env.fetch.calls.length;
    const limited = await upload(auth);
    expect([limited.status, limited.body.code]).toEqual([429, "linkedin_draft_limit"]);
    expect(env.fetch.calls).toHaveLength(count);
    expect(await env.c.repos.linkedinImports.export(user.id)).toHaveLength(3);
  });

  it("disconnect fences an earlier in-flight extraction from recreating drafts", async () => {
    const { user } = await owner();
    let entered!: () => void, release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; }), started = new Promise<void>((r) => { entered = r; });
    env.fetch.on("POST", AI, async () => { entered(); await blocked; return json(extraction()); });
    const pending = env.c.linkedin.create(user.id, { bytes: PDF, filename: "Profile.pdf" });
    const assertion = expect(pending).rejects.toMatchObject({ code: "linkedin_import_cancelled" });
    await started; await env.c.linkedin.disconnect(user.id); release(); await assertion;
    expect(await env.c.repos.linkedinImports.export(user.id)).toHaveLength(0);
    expect(await env.c.repos.fragments.findByUserId(user.id)).toHaveLength(0);
  });

  it("still canonicalizes member URLs for the profile link and legacy snapshots", () => {
    expect(canonicalLinkedInUrl("HTTPS://LINKEDIN.COM/in/Example-Engineer?trk=profile#main")).toBe("https://www.linkedin.com/in/Example-Engineer/");
    for (const url of ["http://www.linkedin.com/in/example/", "https://www.linkedin.com.evil.test/in/example/", "https://www.linkedin.com:443/in/example/", "https://www.linkedin.com/in/../example"]) {
      expect(() => canonicalLinkedInUrl(url)).toThrow();
    }
  });
});

describe("reviewed persistence and safe merge", () => {
  it("enforces draft ownership, section selection and synchronous expiry", async () => {
    const { user, auth } = await owner(), other = await owner();
    const d = await draft(auth);
    expect((await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", other.auth).send({ sections: ["skills"] })).status).toBe(404);
    expect((await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["patents"] })).status).toBe(400);
    await env.mongo.linkedinImports.updateOne({ _id: d.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["skills"] });
    expect(expired.status).toBe(410);
    expect(await env.c.repos.fragments.findByUserId(user.id)).toHaveLength(0);
  });

  it("persists selected evidence only, defaults to source-only, reports IMPORTED and replays one receipt", async () => {
    const { user, auth } = await owner();
    const original = await saveOwnedProfile(user.id), d = await draft(auth);
    const confirm = () => env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["skills"] });
    const first = await confirm(), second = await confirm();
    expect(first.status).toBe(200); expect(first.body.profile).toBeNull(); expect(second.body).toEqual(first.body);
    expect(first.body.import).toMatchObject({ connected: true, method: "pdf", sourceUrl: URL, provider: null, retrievedAt: null, sections: ["skills"] });
    const source = (await env.c.repos.fragments.findByUserIdAndSource(user.id, "LINKEDIN"))!;
    expect(source.version).toBe(1);
    expect(source.data.importMethod).toBe("pdf");
    expect(source.data.profile).toEqual({ skills: ["Python", "SQL"] });
    expect(JSON.stringify(source.data)).not.toContain("Builds developer tools");
    expect(source.data.sections).toHaveLength(1);
    expect((source.data.provenance as { section: string; file: string }[]).every((p) => p.section === "skills" && p.file === "Profile.pdf")).toBe(true);
    expect(await env.c.repos.candidateProfiles.findByUserId(user.id)).toEqual(original);
    expect((await env.http.get(BASE).set("Authorization", auth)).body).toEqual(first.body.import);
    const assembled = (await env.http.get("/api/v1/profile/me").set("Authorization", auth)).body;
    expect(assembled.sources.find((s: { source: string }) => s.source === "LINKEDIN")).toMatchObject({ connected: true, status: "IMPORTED", lastRefreshedAt: first.body.import.importedAt });
    expect(assembled.mostUsedSkills[0].evidence).toContain("self-reported");
    expect((await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["about"] })).status).toBe(409);
  });

  it("merges only approved fields while preserving human edits, level, targets, links, resume and onboarding", async () => {
    const { user, auth } = await owner(), original = await saveOwnedProfile(user.id), d = await draft(auth);
    const response = await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["headline", "about", "experience", "education", "projects", "skills", "achievements"], mergeProfile: true });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const saved = (await env.c.repos.candidateProfiles.findByUserId(user.id))!;
    expect(saved).toMatchObject({ level: "sde2", fullName: original.fullName, headline: original.headline, targetRole: original.targetRole, targetJdId: original.targetJdId, detectedLinks: original.detectedLinks, resumeFilename: original.resumeFilename, resumeParsedAt: original.resumeParsedAt });
    expect(saved.experience).toEqual(original.experience);
    expect(saved.education).toHaveLength(1); expect(saved.projects).toHaveLength(1); expect(saved.skills).toEqual(["python", "SQL"]); expect(saved.achievements).toHaveLength(1);
    expect(response.body.profile.onboardingComplete).toBe(true);
    expect(response.body.import.warnings.some((w: string) => w.includes("conflicting dates"))).toBe(true);
    expect((await env.c.repos.fragments.findByUserIdAndSource(user.id, "LINKEDIN"))?.data.profile).toMatchObject({ about: "Builds developer tools" });
    expect(Object.hasOwn(saved, "about")).toBe(false);
    await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["headline", "about", "experience", "education", "projects", "skills", "achievements"], mergeProfile: true });
    expect(await env.c.repos.candidateProfiles.findByUserId(user.id)).toEqual(saved);
  });

  it("fills missing headline and creates a profile without inferred level only on explicit merge", async () => {
    const { user, auth } = await owner(), d = await draft(auth);
    const response = await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["headline", "skills"], mergeProfile: true });
    expect(response.status).toBe(200); expect(response.body.profile).toMatchObject({ level: null, headline: "Software engineer", skills: ["Python", "SQL"], fullName: null });
    expect((await env.c.repos.candidateProfiles.findByUserId(user.id))?.experience).toEqual([]);
  });

  it("rejects a stale preview after a level-only edit", async () => {
    const { user, auth } = await owner(); await saveOwnedProfile(user.id);
    const d = await draft(auth); await env.c.repos.candidateProfiles.patchLevel(user.id, "staff");
    const response = await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["skills"], mergeProfile: true });
    expect(response.status).toBe(409); expect(response.body.code).toBe("linkedin_profile_changed");
    expect((await env.c.repos.candidateProfiles.findByUserId(user.id))?.level).toBe("staff");
    expect(await env.c.repos.fragments.findByUserId(user.id)).toHaveLength(0);
  });

  it("repository CAS rejects a human edit occurring after the revision check", async () => {
    const { user, auth } = await owner(); await saveOwnedProfile(user.id); const d = await draft(auth);
    const originalCas = env.c.repos.candidateProfiles.compareAndSet.bind(env.c.repos.candidateProfiles);
    vi.spyOn(env.c.repos.candidateProfiles, "compareAndSet").mockImplementation(async (existing, id, patch, revision) => {
      await env.c.repos.candidateProfiles.save({ ...existing!, userId: id, headline: "Concurrent human edit" });
      return originalCas(existing, id, patch, revision);
    });
    const response = await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["skills"], mergeProfile: true });
    expect(response.status).toBe(409);
    expect((await env.c.repos.candidateProfiles.findByUserId(user.id))?.headline).toBe("Concurrent human edit");
    expect(await env.c.repos.fragments.findByUserId(user.id)).toHaveLength(0);
  });

  it("a concurrent confirm cannot double-import and a source-write retry converges", async () => {
    const { user, auth } = await owner(), d = await draft(auth);
    const upsert = env.c.repos.fragments.upsert.bind(env.c.repos.fragments);
    let entered!: () => void, release!: () => void;
    const blocked = new Promise<void>((r) => { release = r; }), started = new Promise<void>((r) => { entered = r; });
    vi.spyOn(env.c.repos.fragments, "upsert").mockImplementationOnce(async (...args) => { entered(); await blocked; return upsert(...args); });
    const first = env.c.linkedin.confirm(user.id, d.id, { sections: ["skills"], mergeProfile: true });
    await started;
    await expect(env.c.accountDeletion.delete(user.id, { confirmEmail: user.email })).rejects.toMatchObject({ code: "linkedin_import_busy" });
    const concurrent = await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["skills"], mergeProfile: true });
    expect(concurrent.status).toBe(409); expect(concurrent.body.code).toBe("linkedin_import_busy"); release(); await first;
    expect((await env.c.repos.fragments.findByUserIdAndSource(user.id, "LINKEDIN"))?.version).toBe(1);
    const user2 = await owner(), d2 = await draft(user2.auth);
    vi.spyOn(env.c.repos.fragments, "upsert").mockRejectedValueOnce(new Error("temporary write failure"));
    const failed = await env.http.post(`${BASE}/imports/${d2.id}/confirm`).set("Authorization", user2.auth).send({ sections: ["skills"], mergeProfile: true });
    expect(failed.status).toBe(503);
    const merged = await env.c.repos.candidateProfiles.findByUserId(user2.user.id);
    const retry = await env.http.post(`${BASE}/imports/${d2.id}/confirm`).set("Authorization", user2.auth).send({ sections: ["skills"], mergeProfile: true });
    expect(retry.status).toBe(200); expect(await env.c.repos.candidateProfiles.findByUserId(user2.user.id)).toEqual(merged);
  });

  it("exports active derived drafts, disconnects source/drafts without removing merged claims, and account deletion purges drafts", async () => {
    const { user, auth } = await owner(), d = await draft(auth);
    expect((await env.c.accountExport.export(user.id))?.linkedinImportDrafts).toHaveLength(1);
    await env.http.post(`${BASE}/imports/${d.id}/confirm`).set("Authorization", auth).send({ sections: ["skills"], mergeProfile: true });
    expect((await env.http.delete(BASE).set("Authorization", auth)).status).toBe(204);
    expect((await env.http.get(BASE).set("Authorization", auth)).body).toMatchObject({ connected: false, method: null, sourceUrl: null });
    expect(await env.c.repos.linkedinImports.export(user.id)).toHaveLength(0);
    expect((await env.c.repos.candidateProfiles.findByUserId(user.id))?.skills).toEqual(["Python", "SQL"]);
    await draft(auth);
    expect(await env.c.accountDeletion.delete(user.id, { confirmEmail: user.email })).toBe(true);
    expect(await env.c.repos.linkedinImports.export(user.id)).toHaveLength(0);
    expect(await env.c.repos.fragments.findByUserId(user.id)).toHaveLength(0);
  });

  it("keeps legacy Firecrawl URL snapshots readable but never auto-connects unsupported fragments", async () => {
    const { user, auth } = await owner();
    await env.c.repos.fragments.insert({ userId: user.id, source: "LINKEDIN", data: { profile: { skills: ["Fabricated"] } }, version: 1, contentHash: "legacy", fetchedAt: new Date() });
    expect((await env.http.get(BASE).set("Authorization", auth)).body.connected).toBe(false);
    expect((await env.http.get("/api/v1/profile/me").set("Authorization", auth)).body.mostUsedSkills).toEqual([]);
    const at = "2026-10-01T00:00:00.000Z";
    const legacy = await owner();
    await env.c.repos.fragments.insert({ userId: legacy.user.id, source: "LINKEDIN", version: 1, contentHash: "legacy-url", fetchedAt: new Date(at),
      data: { importMethod: "url", importedAt: at, provider: "firecrawl", sourceUrl: URL, retrievedAt: at, sections: [{ key: "skills" }], warnings: [] } });
    expect((await env.http.get(BASE).set("Authorization", legacy.auth)).body).toMatchObject({ connected: true, method: "url", provider: "firecrawl", sourceUrl: URL, retrievedAt: at });
    const unsafe = await owner();
    await env.c.repos.fragments.insert({ userId: unsafe.user.id, source: "LINKEDIN", version: 1, contentHash: "pdf-unsafe", fetchedAt: new Date(at),
      data: { importMethod: "pdf", importedAt: at, sourceUrl: "https://evil.test/in/owner/", sections: [{ key: "skills" }] } });
    expect((await env.http.get(BASE).set("Authorization", unsafe.auth)).body).toMatchObject({ connected: true, method: "pdf", sourceUrl: null, provider: null });
  });
});
