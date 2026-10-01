import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OAuthStateService } from "../../src/integrations/github/oauthState.js";
import { json, status } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";

/**
 * GitHub connection routes (/api/v1/connections/github) — no Java controller test existed.
 * Asserts GitHubConnectionController's contract: /authorize returns {url}; /callback is public
 * and always 302s back to the frontend connections page (with ?error=... on failure). GitHub's
 * OAuth, REST and GraphQL endpoints are stubbed.
 */

const AUTHORIZE = "/api/v1/connections/github/authorize";
const CALLBACK = "/api/v1/connections/github/callback";
const DISCONNECT = "/api/v1/connections/github";
const CONNECTIONS_PAGE = "http://localhost:3000/connections";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const GRAPHQL_URL = "https://api.github.com/graphql";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const VIEWER = {
  data: {
    viewer: {
      login: "octocat",
      name: "Octo Cat",
      avatarUrl: "https://avatars.example/octo",
      createdAt: "2015-03-01T00:00:00Z",
      repositories: {
        totalCount: 3,
        nodes: [
          {
            name: "api",
            stargazerCount: 5,
            pushedAt: "2026-01-01T00:00:00Z",
            isFork: false,
            primaryLanguage: { name: "TypeScript" },
            languages: { edges: [{ size: 900, node: { name: "TypeScript" } }, { size: 100, node: { name: "CSS" } }] },
          },
        ],
      },
      contributionsCollection: {
        contributionCalendar: { totalContributions: 321, weeks: [] },
        pullRequestContributionsByRepository: [],
      },
    },
  },
};

async function authorizeUrl(authz: string): Promise<URL> {
  const res = await env.http.get(AUTHORIZE).set("Authorization", authz);
  expect(res.status).toBe(200);
  return new URL(res.body.url);
}

describe("GET /connections/github/authorize", () => {
  it("returns {url} for GitHub's authorize page with client_id, redirect_uri, scope=read:user and a user-bound state", async () => {
    const user = await createUser(env);
    const res = await env.http.get(AUTHORIZE).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["url"]);

    const url = new URL(res.body.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("gh-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8080/api/v1/connections/github/callback");
    expect(url.searchParams.get("scope")).toBe("read:user");
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(new OAuthStateService(env.c.config.jwt.secret).verify(state!)).toBe(user.id);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("requires a JWT", async () => {
    expect((await env.http.get(AUTHORIZE)).status).toBe(401);
  });
});

describe("GET /connections/github/callback (public)", () => {
  it("GitHub's ?error is passed back to the connections page", async () => {
    const res = await env.http.get(`${CALLBACK}?error=access_denied&error_description=The+user+denied`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CONNECTIONS_PAGE}?error=access_denied`);
  });

  it.each([
    ["no params", ""],
    ["no code", "?state=abc"],
    ["no state", "?code=abc"],
  ])("%s → 302 ?error=github_oauth_failed", async (_label, qs) => {
    const res = await env.http.get(`${CALLBACK}${qs}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CONNECTIONS_PAGE}?error=github_oauth_failed`);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("a tampered/forged state → 302 ?error=github_connect_failed without calling GitHub", async () => {
    const res = await env.http.get(`${CALLBACK}?code=abc&state=${Buffer.from("x:1:y").toString("base64url")}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CONNECTIONS_PAGE}?error=github_connect_failed`);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("a failed code exchange → 302 ?error=github_connect_failed and nothing stored", async () => {
    const user = await createUser(env);
    const state = (await authorizeUrl(await bearer(env, user))).searchParams.get("state")!;
    env.fetch.on("POST", TOKEN_URL, { error: "bad_verification_code" });
    const res = await env.http.get(CALLBACK).query({ code: "stale", state });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CONNECTIONS_PAGE}?error=github_connect_failed`);
    expect(await env.c.repos.githubConnections.findByUserId(user.id)).toBeNull();
  });

  it("success: exchanges the code, stores the encrypted token, fetches the profile synchronously, 302s to the connections page", async () => {
    const user = await createUser(env);
    const authz = await bearer(env, user);
    const state = (await authorizeUrl(authz)).searchParams.get("state")!;
    env.fetch.on("POST", TOKEN_URL, { access_token: "gho_secret_token", token_type: "bearer", scope: "read:user" });
    env.fetch.on("GET", USER_URL, { login: "octocat", id: 1 });
    env.fetch.on("POST", GRAPHQL_URL, VIEWER);

    const res = await env.http.get(CALLBACK).query({ code: "the-code", state });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(CONNECTIONS_PAGE);

    const [exchange] = env.fetch.callsTo(TOKEN_URL, "POST");
    expect(exchange?.json).toEqual({
      client_id: "gh-client-id",
      client_secret: "gh-client-secret",
      code: "the-code",
      redirect_uri: "http://localhost:8080/api/v1/connections/github/callback",
    });
    expect(env.fetch.callsTo(USER_URL)[0]?.headers.authorization).toBe("Bearer gho_secret_token");
    expect(env.fetch.callsTo(GRAPHQL_URL)[0]?.headers.authorization).toBe("Bearer gho_secret_token");

    const conn = await env.c.repos.githubConnections.findByUserId(user.id);
    expect(conn?.githubLogin).toBe("octocat");
    expect(conn?.scope).toBe("read:user");
    expect(conn?.accessTokenEnc).not.toContain("gho_secret_token");
    expect(conn?.lastRefreshedAt).toBeInstanceOf(Date);

    const profile = await env.http.get("/api/v1/profile/me").set("Authorization", authz);
    expect(profile.body.sources[0]).toEqual({ source: "GITHUB", connected: true, lastRefreshedAt: conn!.lastRefreshedAt!.toISOString() });
    expect(profile.body.fragments.github).toMatchObject({ login: "octocat", publicRepos: 3, contributions: { lastYear: 321 } });
    // the token never reaches a response
    expect(JSON.stringify(profile.body)).not.toContain("gho_secret_token");
  });

  it("a GitHub API failure during the synchronous fetch → 302 ?error=github_connect_failed", async () => {
    const user = await createUser(env);
    const state = (await authorizeUrl(await bearer(env, user))).searchParams.get("state")!;
    env.fetch.on("POST", TOKEN_URL, { access_token: "gho_x" });
    env.fetch.on("GET", USER_URL, { login: "octocat" });
    env.fetch.on("POST", GRAPHQL_URL, () => status(502));
    const res = await env.http.get(CALLBACK).query({ code: "c", state });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CONNECTIONS_PAGE}?error=github_connect_failed`);
  });

  it("a GraphQL error payload is also github_connect_failed", async () => {
    const user = await createUser(env);
    const state = (await authorizeUrl(await bearer(env, user))).searchParams.get("state")!;
    env.fetch.on("POST", TOKEN_URL, { access_token: "gho_x" });
    env.fetch.on("GET", USER_URL, { login: "octocat" });
    env.fetch.on("POST", GRAPHQL_URL, () => json({ errors: [{ message: "Bad credentials" }] }));
    const res = await env.http.get(CALLBACK).query({ code: "c", state });
    expect(res.headers.location).toBe(`${CONNECTIONS_PAGE}?error=github_connect_failed`);
  });
});

describe("DELETE /connections/github", () => {
  it("204: removes the connection and the GitHub fragment", async () => {
    const user = await createUser(env);
    await env.c.repos.githubConnections.upsert({ userId: user.id, githubLogin: "octo", accessTokenEnc: "enc", scope: "read:user" });
    await env.c.repos.fragments.insert({ userId: user.id, source: "GITHUB", data: { login: "octo" }, contentHash: "h", version: 1, fetchedAt: new Date() });

    const res = await env.http.delete(DISCONNECT).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(await env.c.repos.githubConnections.findByUserId(user.id)).toBeNull();
    expect(await env.c.repos.fragments.findByUserIdAndSource(user.id, "GITHUB")).toBeNull();
  });

  it("requires a JWT", async () => {
    expect((await env.http.delete(DISCONNECT)).status).toBe(401);
  });
});
