import { describe, expect, it } from "vitest";
import { evaluateProfile } from "../../src/domain/profileScoring/engine.js";
import { DEFAULT_SCORING_CONFIG, LEGACY_V1_SCORING_CONFIG, LEGACY_V2_SCORING_CONFIG, LEGACY_V3_SCORING_CONFIG } from "../../src/domain/profileScoring/config.js";
import { buildScoringInput, normalizeScoringInput, sanitizeFragmentData } from "../../src/domain/profileScoring/adapters.js";
import { hashJson } from "../../src/domain/profileScoring/sanitization.js";
import { ENGINEERING_LEVELS, type ScoringInput, type ScoringProfile } from "../../src/domain/profileScoring/types.js";
import type { ProfileFragmentDoc } from "../../src/db/mongo/client.js";

const asOf = "2026-10-04T00:00:00.000Z";
const basic = "Built and deployed a service with tests.";
const senior = `${basic} Owned the service end-to-end. Reduced service latency by 40%. Designed a distributed platform across multiple teams balancing consistency and availability. Led architecture standards adopted across teams. Defined organization-wide technical strategy and multi-year investment roadmap. Reduced organization-wide platform latency by 50%. Authored RFC 1234 adopted by 3 independent organizations and reduced service latency by 30%.`;
const profile = (fields: Partial<ScoringProfile> = {}): ScoringProfile => ({ headline: null, education: [], experience: [], projects: [], skills: [], achievements: [], ...fields });
const data = (claim = senior, fields: Record<string, unknown> = {}): Record<string, unknown> => ({ importMethod: "archive", importedAt: asOf, partial: false,
  profile: { ...profile(), about: claim }, sections: [{ key: "about", label: "About", entries: [claim], sourceFile: "Profile.csv" }],
  provenance: [{ section: "about", path: "profile.about", file: "Profile.csv", quote: claim }], ...fields });
const input = (payload = data(), fields: Partial<ScoringInput> = {}): ScoringInput => ({ asOf, declaredLevel: null, profile: null,
  fragments: [{ source: "LINKEDIN", data: payload, fetchedAt: asOf, contentHash: "untrusted" }], ...fields });
const urlData = (claim = senior, fields: Record<string, unknown> = {}) => data(claim, {
  importMethod: "url", sourceUrl: "https://www.linkedin.com/in/owner-provided-profile/", provider: "exa", retrievedAt: "2026-10-03T00:00:00.000Z", partial: true,
  provenance: [{ section: "about", path: "profile.about", file: null, quote: claim }], ...fields,
});
const numeric = (value: ReturnType<typeof evaluateProfile>) => ({ score: value.score, coverage: value.coverage, confidence: value.confidence,
  assessedLevel: value.classification.assessedLevel, components: value.components.map((x) => [x.id, x.score]) });

describe("v4 consented LinkedIn scoring and frozen legacy replay", () => {
  it("preserves v3 Exa frozen normalization, complete evaluation and config golden hashes", () => {
    const frozen = normalizeScoringInput(input(urlData(basic), { declaredLevel: "fresher" }), LEGACY_V3_SCORING_CONFIG.version);
    expect(hashJson(frozen)).toBe("eece8d455a7d22890f5cbbec6e400e63f7a732962fb9a70511c815e346bebad8");
    expect(hashJson(evaluateProfile(frozen, LEGACY_V3_SCORING_CONFIG))).toBe("e1768edec90795366b3d65b13d3ed80a04cd434767a2b2f7d9b5f37370e893a6");
    expect(hashJson(LEGACY_V3_SCORING_CONFIG)).toBe("1827c57030fbc2f8410c9cd86e974a038c0f271f108d75511d389dde4ce26165");
    expect(evaluateProfile(input(urlData(basic, { provider: "firecrawl" })), LEGACY_V3_SCORING_CONFIG).score).toBeNull();
  });

  it("accepts Firecrawl and historical Exa in v4 without changing weights, paths, deduplication or confidence", () => {
    expect(DEFAULT_SCORING_CONFIG.version).toBe("profile-beta-v4");
    expect(DEFAULT_SCORING_CONFIG.weights).toEqual(LEGACY_V3_SCORING_CONFIG.weights);
    expect(DEFAULT_SCORING_CONFIG.normalizers).toEqual(LEGACY_V3_SCORING_CONFIG.normalizers);
    expect(DEFAULT_SCORING_CONFIG.thresholds).toEqual(LEGACY_V3_SCORING_CONFIG.thresholds);
    const resume = profile({ projects: [{ name: null, description: basic, tech: [], bullets: [], link: null }] });
    const raw = input(urlData(basic, { provider: "firecrawl", verified: true, confidence: 100, employmentVerified: true }), { profile: resume });
    const firecrawl = evaluateProfile(raw);
    const exa = evaluateProfile(input(urlData(basic), { profile: resume }));
    expect(numeric(firecrawl)).toEqual(numeric(exa));
    expect(firecrawl.evidence).toEqual(exa.evidence);
    expect(firecrawl.evidence).toHaveLength(1);
    expect(firecrawl.evidence[0]).toMatchObject({ confidence: 45, verification: "self_reported" });
    expect(firecrawl.sources.find((s) => s.source === "linkedin")).toMatchObject({ provider: "firecrawl", status: "partial" });
    expect(firecrawl.eligibility.eligible).toBe(false);
    expect(JSON.stringify(normalizeScoringInput(raw, DEFAULT_SCORING_CONFIG.version))).not.toContain("employmentVerified");
    expect(normalizeScoringInput(raw, DEFAULT_SCORING_CONFIG.version).fragments[0]!.data.provider).toBe("firecrawl");
  });
  it("scores selected public URL claims at all eight levels with retrieval provenance and self-report confidence only", () => {
    for (const declaredLevel of ENGINEERING_LEVELS) {
      const result = evaluateProfile(input(urlData(senior, { verified: true, confidence: 90, partial: false }), { declaredLevel }));
      expect(result.classification.assessedLevel).toBe("principal");
      expect(result.confidence).toBe(45);
      expect(result.evidence.every((x) => x.verification === "self_reported" && x.observedAt === "2026-10-03T00:00:00.000Z")).toBe(true);
      expect(result.sources.find((x) => x.source === "linkedin")).toMatchObject({ status: "partial", importMethod: "url", provider: "exa", importedAt: asOf, retrievedAt: "2026-10-03T00:00:00.000Z", ageDays: 1 });
      expect(result.eligibility.eligible).toBe(false);
      expect(result.warnings.join(" ")).toContain("not verified employment or OAuth identity proof");
      expect(result.warnings.join(" ")).toContain("provider retrieval never grants collector confidence");
    }
  });

  it.each([
    { retrievedAt: undefined }, { retrievedAt: "invalid" }, { retrievedAt: "2026-02-31" },
    { retrievedAt: "2026-10-05T00:00:00Z" }, { retrievedAt: "2025-01-01T00:00:00Z" },
    { retrievedAt: asOf, importedAt: "2026-10-03T00:00:00Z" }, { importedAt: "2026-10-05T00:00:00Z" },
    { provider: "untrusted" }, { provider: null },
  ])("excludes invalid/future/stale URL receipt metadata %j", (metadata) => {
    const result = evaluateProfile(input(urlData(senior, metadata)));
    expect(result.score).toBeNull();
    expect(result.evidence).toHaveLength(0);
    expect(result.sources.find((x) => x.source === "linkedin")?.status).toBe("missing");
  });

  it("anchors URL freshness to retrieval even when confirmation is later and allows fetchedAt to represent retrieval", () => {
    const raw = input(urlData()); raw.fragments[0]!.fetchedAt = "2026-10-03T00:00:00.000Z";
    expect(evaluateProfile(raw).confidence).toBe(45);
    raw.fragments[0]!.fetchedAt = "2026-10-02T00:00:00.000Z";
    expect(evaluateProfile(raw).score).toBeNull();
    expect(evaluateProfile(input(urlData(senior, { retrievedAt: "2025-01-01T00:00:00Z", importedAt: asOf }))).score).toBeNull();
  });

  it("keeps source URL, owner identity and employer out of frozen input/content hashes and URL shell unscored", () => {
    const raw = input(urlData(basic));
    const normalized = normalizeScoringInput(raw, "profile-beta-v3");
    expect(JSON.stringify(normalized)).not.toContain("linkedin.com");
    expect(JSON.stringify(normalized)).not.toContain("sourceUrl");
    expect(normalizeScoringInput(input(urlData(basic, { sourceUrl: "https://www.linkedin.com/in/different-identity/" })), "profile-beta-v3")).toEqual(normalized);
    expect(normalizeScoringInput(normalized, "profile-beta-v3")).toEqual(normalized);
    const empty = evaluateProfile(input(urlData("", { profile: { ...profile(), headline: "Principal Engineer", fullName: "Private Owner" } })));
    expect(empty.score).toBeNull();
    expect(empty.classification.assessedLevel).toBe("fresher");
    expect(empty.sources.find((x) => x.source === "linkedin")?.status).toBe("partial");
    expect(JSON.stringify(empty)).not.toContain("Private Owner");
  });

  it("obeys URL section selection and deduplicates repeated resume/URL claims with no tenure or evidence inflation", () => {
    const role = { company: "Example", title: null, startDate: "2025-01", endDate: "Present", bullets: [basic] };
    const raw = urlData(basic, { profile: { ...profile(), about: basic, experience: [role, role], skills: ["TypeScript"] }, sections: [{ key: "about" }, { key: "experience" }] });
    const baseline = evaluateProfile(input(raw));
    const withResume = evaluateProfile(input(raw, { profile: profile({ experience: [role, role] }) }));
    expect(numeric(withResume)).toEqual(numeric(baseline));
    expect(withResume.evidence).toHaveLength(baseline.evidence.length);
    expect(withResume.evidence.find((x) => typeof x.value === "number")?.value).toBe(baseline.evidence.find((x) => typeof x.value === "number")?.value);
    expect(withResume.evidence.some((x) => x.paths?.some((p) => p.startsWith("resume.")) && x.provenance?.length)).toBe(true);
    expect(normalizeScoringInput(input(raw), "profile-beta-v3").fragments[0]!.data.profile).toMatchObject({ skills: [] });
    expect(evaluateProfile(input(urlData(senior, { sections: [{ key: "skills" }] }))).score).toBeNull();
  });

  it("preserves actual extractor dotted row paths in scored URL provenance and frozen replay", () => {
    const raw = urlData("", {
      profile: { ...profile(), experience: [{ company: "Example", title: "Engineer", startDate: null, endDate: null, bullets: [basic] }] },
      sections: [{ key: "experience" }],
      provenance: [{ section: "experience", path: "profile.experience.0.bullets.0", file: null, quote: basic }],
    });
    const result = evaluateProfile(input(raw));
    expect(result.evidence.find((item) => item.claim === basic)?.provenance).toEqual([
      { section: "experience", path: "profile.experience.0.bullets.0", file: null, quote: basic },
    ]);
    const frozen = normalizeScoringInput(input(raw), "profile-beta-v3");
    expect(evaluateProfile(frozen)).toEqual(result);
  });

  it("keeps v2 weights unchanged and evaluates LinkedIn-only evidence at all eight levels", () => {
    expect(DEFAULT_SCORING_CONFIG.weights).toEqual(LEGACY_V2_SCORING_CONFIG.weights);
    for (const declaredLevel of ENGINEERING_LEVELS) {
      const result = evaluateProfile(input(data(), { declaredLevel }));
      expect(result.level).toBe(declaredLevel);
      expect(result.classification.assessedLevel).toBe("principal");
      expect(result.classification.confidence).toBe(45);
      expect(result.confidence).toBe(45);
      expect(result.score).not.toBeNull();
      expect(result.eligibility.eligible).toBe(false);
      expect(result.eligibility.reasons).toContain("No sufficiently current collector evidence in an available scoring component");
      expect(result.sources.find((x) => x.source === "linkedin")).toMatchObject({ status: "available", importMethod: "archive", importedAt: asOf });
      expect(result.evidence.every((x) => x.verification === "self_reported")).toBe(true);
    }
  });

  it.each(["archive", "pdf", "text"])("retains %s method without trusting verified/confidence/follower flags", (importMethod) => {
    const result = evaluateProfile(input(data(basic, { importMethod, verified: true, confidence: 90, followers: 900000, employmentVerified: true })));
    expect(result.confidence).toBe(45);
    expect(result.evidence).toEqual([expect.objectContaining({ source: "linkedin", confidence: 45, verification: "self_reported", path: "fragments.linkedin.profile.about" })]);
    expect(result.warnings.join(" ")).toContain("never employment verification");
  });

  it("distinguishes missing/partial imports and unknown components from collector zero", () => {
    const missing = evaluateProfile({ ...input(), fragments: [] });
    expect(missing.sources.find((x) => x.source === "linkedin")?.status).toBe("missing");
    const partial = evaluateProfile(input(data("", { partial: true })));
    expect(partial.sources.find((x) => x.source === "linkedin")?.status).toBe("partial");
    expect(partial.score).toBeNull();
    expect(partial.components.every((x) => x.score === null)).toBe(true);
    const zero = evaluateProfile(input(data(""), { fragments: [{ source: "leetcode", data: { solved: { easy: 0, medium: 0, hard: 0 } }, fetchedAt: asOf, contentHash: "" }] }));
    expect(zero.score).toBe(0);
  });

  it("uses only selected skills and requires independent GitHub language corroboration", () => {
    const github = { source: "github", data: { languages: [{ name: "TypeScript", bytes: 10 }] }, fetchedAt: asOf, contentHash: "" };
    const raw = data("", { profile: { ...profile(), skills: ["TypeScript"] }, sections: [{ key: "about" }] });
    const unselected = input(raw); unselected.fragments.push(github);
    expect(evaluateProfile(unselected).score).toBeNull();
    raw.sections = [{ key: "skills" }];
    expect(evaluateProfile(unselected).score).toBe(70);
    expect(evaluateProfile(input(raw)).score).toBeNull();
  });

  it("scores selected project/experience descriptions but never title/education/achievement prestige", () => {
    const raw = data("", { profile: { headline: "Distinguished Engineer", education: [{ institution: "Elite University", degree: "PhD" }],
      experience: [{ company: "FamousCo", title: "Principal", startDate: "2020-01", endDate: "Present", bullets: [basic] }],
      projects: [{ name: "Important", description: "Owned the service end-to-end.", tech: ["Go"] }], skills: [], achievements: ["ICPC winner", "GSoC completed"] },
      sections: ["headline", "education", "experience", "projects", "achievements"].map((key) => ({ key })) });
    const result = evaluateProfile(input(raw, { declaredLevel: "fresher" }));
    expect(result.classification.assessedLevel).toBe("sde1");
    expect(result.components.find((x) => x.id === "achievements")?.score).toBeNull();
    expect(result.evidence.some((x) => x.path.includes("experience"))).toBe(true);
    const titles = { ...raw, profile: { ...raw.profile as object, experience: [{ company: "FamousCo", title: senior }], projects: [] } };
    expect(evaluateProfile(input(titles)).score).toBeNull();
    expect(evaluateProfile(input(titles)).classification.assessedLevel).toBe("fresher");
  });

  it("never scores contextual certifications/publications/patents entries or unselected semantic sections", () => {
    const raw = data(senior, { sections: ["certifications", "publications", "patents"].map((key) => ({ key, entries: [senior] })) });
    expect(evaluateProfile(input(raw)).score).toBeNull();
    expect(JSON.stringify(normalizeScoringInput(input(raw), "profile-beta-v3"))).not.toContain(senior);
  });

  it("excludes stale, invalid and future imports/observations deterministically", () => {
    for (const importedAt of ["invalid", "2026-02-31", "2026-10-05T00:00:00Z", "2025-01-01T00:00:00Z"]) {
      const result = evaluateProfile(input(data(senior, { importedAt })));
      expect(result.score).toBeNull();
      expect(result.classification.assessedLevel).toBe("fresher");
      expect(result.sources.find((x) => x.source === "linkedin")?.status).toBe("missing");
    }
    const raw = input(); raw.fragments[0]!.fetchedAt = "2027-01-01T00:00:00Z";
    expect(evaluateProfile(raw).score).toBeNull();
  });

  it("deduplicates repeated employment/projects before hashing and never earns repeated evidence", () => {
    const role = { company: "Example", title: "Engineer", startDate: "2025-01", endDate: "Present", bullets: [basic, basic] };
    const project = { name: "App", description: basic, bullets: [basic] };
    const raw = data("", { profile: { ...profile(), experience: [role], projects: [project] }, sections: [{ key: "experience" }, { key: "projects" }] });
    const baseline = evaluateProfile(input(raw));
    const repeated = data("", { ...raw, profile: { ...profile(), experience: [role, role, { ...role, company: "Other", title: "Staff" }], projects: [project, project, { ...project, name: "Copy" }] } });
    const result = evaluateProfile(input(repeated));
    expect(result).toEqual(baseline);
    expect(baseline.evidence.filter((x) => x.claim === basic)).toHaveLength(1);
    expect(baseline.evidence.find((x) => x.claim === basic)?.paths).toHaveLength(3);
  });

  it("tracks duplicate resume/import paths and receipts without more semantic evidence, confidence or tenure", () => {
    const role = { company: "Example", title: null, startDate: "2025-01", endDate: "Present", bullets: [senior] };
    const raw = data(senior, { profile: { ...profile(), about: senior, experience: [role] }, sections: [{ key: "about" }, { key: "experience" }] });
    const baseline = evaluateProfile(input(raw));
    const result = evaluateProfile(input(raw, { profile: profile({ experience: [role] }) }));
    expect(numeric(result)).toEqual(numeric(baseline));
    expect(result.evidence).toHaveLength(baseline.evidence.length);
    expect(result.evidence.find((x) => typeof x.value === "number")?.value).toBe(baseline.evidence.find((x) => typeof x.value === "number")?.value);
    expect(result.evidence.some((x) => x.paths?.some((path) => path.startsWith("resume.")) && x.paths.some((path) => path.startsWith("fragments.linkedin.")))).toBe(true);
    expect(result.evidence.some((x) => x.provenance?.some((p) => p.file === "profile.csv"))).toBe(true);
  });

  it("minimizes known identities, contacts, URLs, company prestige and raw sections; normalizing twice preserves hashes", () => {
    const raw = data(`Built and deployed a service with tests at FamousCo by Jane Doe in Seattle https://private.example.com jane@example.com.`, {
      fullName: "Jane Doe", location: "Seattle", profile: { ...profile(), fullName: "Jane Doe", about: `Built and deployed a service with tests at FamousCo by Jane Doe in Seattle https://private.example.com jane@example.com.`, experience: [{ company: "FamousCo", location: "Seattle" }] },
      sections: [{ key: "about", label: "Jane Doe", entries: ["RAW_PRIVATE_CONTENT"] }],
      provenance: [{ section: "about", path: "profile.about", file: "Jane Doe.pdf", quote: "RAW_PRIVATE_CONTENT" }],
    });
    const fragment: ProfileFragmentDoc = { _id: "fragment", userId: "user", source: "LINKEDIN", data: raw, version: 1, fetchedAt: new Date(asOf), contentHash: "raw" };
    const frozen = buildScoringInput(null, [fragment], { asOf, declaredLevel: null, version: "profile-beta-v3" });
    const serialized = JSON.stringify(frozen);
    for (const secret of ["Jane Doe", "FamousCo", "Seattle", "jane@example.com", "https://", "RAW_PRIVATE_CONTENT", ".pdf"]) expect(serialized).not.toContain(secret);
    expect(normalizeScoringInput(frozen, "profile-beta-v3")).toEqual(frozen);
    expect(evaluateProfile(frozen).inputHash).toBe(hashJson(frozen));
  });

  it("retains legacy helper defaults and exact unsupported LinkedIn v1/v2 evaluation and input hashes", () => {
    const raw = input({ profile: { about: basic }, verified: true });
    expect(sanitizeFragmentData("linkedin", raw.fragments[0]!.data)).toEqual({});
    expect(normalizeScoringInput(raw).fragments[0]!.data).toEqual({});
    for (const [config, golden] of [[LEGACY_V1_SCORING_CONFIG, "af4d6a3c555a64ed6de9c5110e4107fa1887e6680ed6a931407efbc29ab88a94"], [LEGACY_V2_SCORING_CONFIG, "0ab133d80bdf55d60212dbfd34aaabe45900e33a0da054a6e04cc992a6b1a52f"]] as const) {
      const replay = evaluateProfile(raw, config);
      expect(replay.inputHash).toBe("57f42b17c538335216455e2b3bcf90bca167f55820198d0c0e0fcff3f8704503");
      expect(hashJson(replay)).toBe(golden);
      expect(evaluateProfile(normalizeScoringInput(raw, config.version), config)).toEqual(replay);
      expect(replay.sources.find((x) => x.source === "linkedin")?.status).toBe("unsupported");
    }
  });

  it("replays v2 all-eight semantic/industry policies against hashes captured before v3", () => {
    const raw = input({ profile: { about: "Built a service." } }, { profile: profile({ projects: [{ name: null, description: senior, tech: [], bullets: [], link: null }] }) });
    const goldens = { unset: "902c0454d3b71d814cdf30b841734f47b08a440bd8be32e839ff6291ea082253", fresher: "a191c586ac3f5658807b671f73ad261702351701bbab6487c505b144def524c9", sde1: "7cf3ad9e03d3d3fa4a03800fa04f820fbcaedb3c18c7a4279469521775f02c68", sde2: "698df1d3024d5e802fdce396f738055f1f784a07f4157ca9a01c06c1d148c154", sde3: "1fdb16280cfc6cc5bc11857061814ebd30b5562229e7324e744c853fdd9929ed", staff: "90ac62dafe36f1cb4928831cff75ed82164bc159cbdbd7afebe4ff81fc60825f", principal: "7edede2a9de0cb3ea41e1782ca3ebbe356ee2b5cb3a9f72e5178fe12b56feacb", intern: "ad726516e2af199a565868c7a4ca4bf6ecb8802c7bfedb7dac6c1fa2ca2e1659", distinguished: "c173c7a77de35b3e29f7a0dace6b4863e0ca98b42a6f1f93577cbf800a9775f4" };
    for (const declaredLevel of [null, ...ENGINEERING_LEVELS]) expect(hashJson(evaluateProfile({ ...raw, declaredLevel }, LEGACY_V2_SCORING_CONFIG))).toBe(goldens[declaredLevel ?? "unset"]);
  });
});
