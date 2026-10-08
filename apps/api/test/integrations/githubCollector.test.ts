import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GitHubConnectionRow } from "../../src/db/pg/schema.js";
import { GITHUB_GRAPHQL_QUERY, GITHUB_MERGED_PRS_QUERY, GitHubCollector, toGitHubFragmentJson } from "../../src/integrations/github/collector.js";
import { canonicalize, sha256Hex } from "../../src/lib/canonicalJson.js";
import { TokenCipher } from "../../src/lib/crypto.js";
import { UpstreamHttpError } from "../../src/lib/http.js";
import { ProfileFragmentRepository } from "../../src/repositories/mongo.js";
import { FakeFetch, status } from "../support/fakeFetch.js";
import { createTestMongo } from "../support/harness.js";

/** Ported from integrations/github/GitHubCollectorTest.java (+ collectAndStore coverage). */

const fixtureRoot: unknown = JSON.parse(readFileSync(new URL("../fixtures/github-graphql-response.json", import.meta.url), "utf8"));

type Fragment = {
  login: string;
  name: string;
  joinedYear: number;
  publicRepos: number;
  contributions: { lastYear: number; weeks: number[][] };
  languages: { name: string; pct: number; bytes: number }[];
  topRepos: { name: string; stars: number; primaryLang: string }[];
  externalPRs: number;
};

const parse = (canonical: string) => JSON.parse(canonical) as Fragment;

describe("toGitHubFragmentJson (ported from GitHubCollectorTest)", () => {
  it("toFragmentJson_mapsCoreProfileFields", () => {
    const f = parse(toGitHubFragmentJson(fixtureRoot));
    expect(f.login).toBe("aishav");
    expect(f.name).toBe("Aisha Verma");
    expect(f.joinedYear).toBe(2021);
    expect(f.publicRepos).toBe(38);
    expect(f.contributions.lastYear).toBe(1204);
  });

  it("toFragmentJson_excludesForksAndComputesExternalPRs", () => {
    const f = parse(toGitHubFragmentJson(fixtureRoot));
    // forked-stuff must NOT appear in topRepos (skip-list: forks)
    expect(JSON.stringify(f.topRepos)).not.toContain("forked-stuff");
    // external PRs = PRs to repos NOT owned by the user = 9 (vercel) + 8 (facebook) = 17
    expect(f.externalPRs).toBe(17);
  });

  it("toFragmentJson_buildsLanguagePercentagesFromNonForkBytes", () => {
    const languages = parse(toGitHubFragmentJson(fixtureRoot)).languages;
    // TS 800k + Python 400k + CSS 200k = 1.4M non-fork bytes -> TS = 57%
    expect(languages[0]!.name).toBe("TypeScript");
    expect(languages[0]!.pct).toBe(57);
    // the forked repo's Java bytes are not counted
    expect(languages.map((l) => l.name)).not.toContain("Java");
  });

  it("contentHash_isStableForSameInput_andChangesWhenDataChanges", () => {
    const canonical1 = toGitHubFragmentJson(fixtureRoot);
    const canonical2 = toGitHubFragmentJson(fixtureRoot);
    expect(sha256Hex(canonical1)).toBe(sha256Hex(canonical2));

    // mutate one field -> different canonical JSON -> different hash
    expect(canonical1).toContain('"lastYear":1204');
    const mutated = JSON.parse(canonical1.replace('"lastYear":1204', '"lastYear":1205')) as unknown;
    expect(sha256Hex(canonicalize(mutated))).not.toBe(sha256Hex(canonical1));
  });

  it("canonicalize_isKeyOrderIndependent", () => {
    const a = JSON.parse('{"b":1,"a":2}') as unknown;
    const b = JSON.parse('{"a":2,"b":1}') as unknown;
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});

describe("toGitHubFragmentJson — byte-compatibility with the Java canonical form", () => {
  // What the Java GitHubCollector.toFragmentJson emits for the fixture: keys sorted at every level,
  // no whitespace, integers. Hashes of pre-migration fragments depend on this exact byte string.
  const JAVA_CANONICAL =
    '{"avatarUrl":"https://avatars.githubusercontent.com/u/123",' +
    '"contributions":{"lastYear":1204,"weeks":[[0,1,3,0,2,5,1],[2,0,0,4,1,0,3]]},' +
    '"externalPRs":17,"joinedYear":2021,' +
    '"languages":[{"bytes":800000,"name":"TypeScript","pct":57},{"bytes":400000,"name":"Python","pct":29},{"bytes":200000,"name":"CSS","pct":14}],' +
    '"login":"aishav","name":"Aisha Verma","publicRepos":38,' +
    '"topRepos":[{"name":"campus-placement-bot","primaryLang":"TypeScript","stars":42},{"name":"ml-notes","primaryLang":"Python","stars":7}]}';

  it("matches the Java canonical string exactly", () => {
    expect(toGitHubFragmentJson(fixtureRoot)).toBe(JAVA_CANONICAL);
  });

  it("canonicalize sorts nested keys and keeps array order", () => {
    expect(canonicalize({ z: [{ b: 1, a: 2 }, 3], a: { d: null, c: "x" } })).toBe('{"a":{"c":"x","d":null},"z":[{"a":2,"b":1},3]}');
  });

  it("an empty / missing viewer maps to defaults instead of throwing (Jackson path().asX(default))", () => {
    const f = parse(toGitHubFragmentJson({ data: {} }));
    expect(f).toEqual({
      avatarUrl: "",
      contributions: { lastYear: 0, weeks: [] },
      externalPRs: 0,
      joinedYear: 0,
      languages: [],
      login: "",
      name: "",
      publicRepos: 0,
      topRepos: [],
    });
  });

  it("topRepos is sorted by stars desc and capped at 10", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ name: `r${i}`, stargazerCount: i, isFork: false }));
    const f = parse(toGitHubFragmentJson({ data: { viewer: { login: "me", repositories: { nodes } } } }));
    expect(f.topRepos).toHaveLength(10);
    expect(f.topRepos.map((r) => r.stars)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });
});

describe("GitHubCollector.collectAndStore", () => {
  const GRAPHQL_URL = "https://api.github.com/graphql";
  const cipher = new TokenCipher(Buffer.alloc(32, 7).toString("base64"));
  let mongo: Awaited<ReturnType<typeof createTestMongo>>;
  let fragments: ProfileFragmentRepository;
  let fake: FakeFetch;
  let collector: GitHubCollector;

  beforeAll(async () => {
    mongo = await createTestMongo();
    fragments = new ProfileFragmentRepository(mongo.mongo);
  });
  afterAll(() => mongo.close());

  beforeEach(() => {
    fake = new FakeFetch();
    collector = new GitHubCollector(GRAPHQL_URL, cipher, fragments, fake.fetch);
  });

  function connection(userId: string): GitHubConnectionRow {
    return {
      id: randomUUID(),
      userId,
      githubLogin: "aishav",
      accessTokenEnc: cipher.encrypt("gho_plainToken"),
      scope: "read:user",
      connectedAt: new Date(),
      lastRefreshedAt: null,
      status: "SYNCED",
    };
  }

  it("POSTs the GraphQL query with the decrypted bearer token and stores fragment v1", async () => {
    fake.on("POST", GRAPHQL_URL, fixtureRoot);
    const userId = randomUUID();
    await collector.collectAndStore(connection(userId));

    // Main query first; the merged-PR search is a separate best-effort call.
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.json).toEqual({ query: GITHUB_MERGED_PRS_QUERY, variables: { q: "author:aishav is:pr is:merged is:public -user:aishav sort:updated-desc" } });
    const call = fake.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(GRAPHQL_URL);
    expect(call.headers["authorization"]).toBe("Bearer gho_plainToken");
    expect(call.headers["user-agent"]).toBe("interviewiq-backend");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.json).toEqual({ query: GITHUB_GRAPHQL_QUERY });

    const stored = await fragments.findByUserIdAndSource(userId, "GITHUB");
    expect(stored).not.toBeNull();
    expect(stored!.version).toBe(1);
    expect(stored!.contentHash).toBe(sha256Hex(toGitHubFragmentJson(fixtureRoot)));
    expect(stored!.data).toEqual(JSON.parse(toGitHubFragmentJson(fixtureRoot)));
  });

  it("unchanged hash only bumps fetchedAt; changed data bumps the version", async () => {
    fake.on("POST", GRAPHQL_URL, fixtureRoot);
    const userId = randomUUID();
    const conn = connection(userId);
    await collector.collectAndStore(conn);
    const first = (await fragments.findByUserIdAndSource(userId, "GITHUB"))!;

    await new Promise((r) => setTimeout(r, 5));
    await collector.collectAndStore(conn);
    const second = (await fragments.findByUserIdAndSource(userId, "GITHUB"))!;
    expect(second._id).toBe(first._id);
    expect(second.version).toBe(1);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.fetchedAt.getTime()).toBeGreaterThan(first.fetchedAt.getTime());

    const changed = structuredClone(fixtureRoot) as { data: { viewer: { contributionsCollection: { contributionCalendar: { totalContributions: number } } } } };
    changed.data.viewer.contributionsCollection.contributionCalendar.totalContributions = 1205;
    fake.on("POST", GRAPHQL_URL, changed);
    await collector.collectAndStore(conn);
    const third = (await fragments.findByUserIdAndSource(userId, "GITHUB"))!;
    expect(third._id).toBe(first._id);
    expect(third.version).toBe(2);
    expect(third.contentHash).not.toBe(first.contentHash);
    expect((third.data as Fragment).contributions.lastYear).toBe(1205);
  });

  it("a GraphQL `errors` payload throws and stores nothing", async () => {
    fake.on("POST", GRAPHQL_URL, { errors: [{ message: "Bad credentials" }] });
    const userId = randomUUID();
    await expect(collector.collectAndStore(connection(userId))).rejects.toThrow(/GitHub GraphQL returned errors: .*Bad credentials/);
    expect(await fragments.findByUserIdAndSource(userId, "GITHUB")).toBeNull();
  });

  it("a non-2xx response propagates as UpstreamHttpError with its status", async () => {
    fake.on("POST", GRAPHQL_URL, () => status(401, "Bad credentials"));
    const userId = randomUUID();
    const err = await collector.collectAndStore(connection(userId)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamHttpError);
    expect((err as UpstreamHttpError).status).toBe(401);
    expect(await fragments.findByUserIdAndSource(userId, "GITHUB")).toBeNull();
  });
});
