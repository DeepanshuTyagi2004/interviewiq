### Task 6: Account deletion (`DELETE /users/me`)

**Files:**
- Modify: `apps/api/src/integrations/aiService/client.ts` (`purgeUser`)
- Modify: `apps/api/src/integrations/github/oauth.ts` (`revokeGrant`)
- Modify: `apps/api/src/repositories/mongo.ts` (deletes)
- Modify: `apps/api/src/repositories/pg.ts` (`UserRepository.deleteCascade`)
- Create: `apps/api/src/services/accountDeletion.ts`
- Modify: `apps/api/src/routes/account.ts`, `apps/api/src/container.ts`
- Test: `apps/api/test/routes/accountDeletion.test.ts`

**Interfaces:**
- Consumes:
  - `c.preferences` / `UserPreferencesRepository.deleteByUserId` (Task 2)
  - `clearRefreshTokenCookie` (Task 3)
  - AI `POST /users/purge` (Task 5)
  - `verifyPassword(password, stored)` from `src/lib/password.ts`
  - `enforceRateLimit`, `clientIp`, `rateLimitErrors` from `src/http/rateLimit.ts`
- Produces:
  - `AiServiceClient.purgeUser(sessionIds: string[]): Promise<number>`
  - `GitHubOAuthService.revokeGrant(accessTokenEnc: string): Promise<void>`
  - `CandidateProfileRepository.deleteByUserId`, `ProfileFragmentRepository.deleteByUserId`, `SessionOutcomeRepository.deleteBySessionIds`
  - `UserRepository.deleteCascade(userId)`
  - `AccountDeletionService.delete(userId, { confirmEmail, password? }): Promise<boolean>` (false = user not found)
  - error classes `ConfirmationMismatchError`, `InvalidPasswordError`, `InterviewInProgressError`, `DeletionUnavailableError`
  - container key `c.accountDeletion`

- [ ] **Step 1: Write the failing test** (`apps/api/test/routes/accountDeletion.test.ts`)

```ts
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Response } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authTokens, githubConnections, interviewSessions, leetcodeConnections, refreshTokens, users } from "../../src/db/pg/schema.js";
import type { SessionStatus } from "../../src/domain/enums.js";
import { TokenCipher } from "../../src/lib/crypto.js";
import { json, status } from "../support/fakeFetch.js";
import { bearer, createTestEnv, createUser, TEST_INTERNAL_KEY, TEST_TOKEN_KEY, type TestEnv } from "../support/harness.js";
import { AI } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const PW = "correct-horse-battery";
const ME = "/api/v1/users/me";
const PURGE = `${AI}/users/purge`;
const GH_REVOKE = "https://api.github.com/applications/gh-client-id/grant";
const cipher = new TokenCipher(TEST_TOKEN_KEY);

function setCookies(res: Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  return ([] as string[]).concat(raw ?? []).join(";");
}

async function passwordUser() {
  const email = `d-${randomUUID().slice(0, 8)}@example.com`;
  const { user, refreshToken } = await env.c.passwordAuth.register({ name: "Del", email, password: PW });
  await env.c.background.drain(); // the verify-email token row is written in the background
  return { user, email, refreshToken, token: await bearer(env, user) };
}

async function seed(userId: string, sessionStatus: SessionStatus = "COMPLETED") {
  const session = (s: SessionStatus) =>
    env.c.repos.sessions.insert({
      candidateId: userId, jobDescriptionId: randomUUID(), company: "meesho", role: "software-engineer", level: "sde1",
      roundType: "dsa", scheduledAt: new Date(), timezone: "Asia/Kolkata", status: s,
    });
  const a = await session(sessionStatus);
  const b = await session("SCHEDULED");
  await env.c.repos.outcomes.save(a.id, { verdict: "lean_hire" });
  await env.c.repos.candidateProfiles.save({
    userId, fullName: "Del", email: null, phone: null, location: null, headline: null, targetRole: null, targetJdId: null,
    education: [], experience: [], projects: [], skills: [], achievements: [],
    detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: null, resumeParsedAt: null,
  });
  await env.c.repos.fragments.insert({ userId, source: "LEETCODE", data: { solved: { total: 3 } }, contentHash: "h", version: 1, fetchedAt: new Date() });
  await env.c.repos.githubConnections.upsert({ userId, githubLogin: "del", accessTokenEnc: cipher.encrypt("gho_secret"), scope: "read:user" });
  await env.c.repos.leetcodeConnections.upsertSyncing(userId, "del_lc");
  await env.c.preferences.update(userId, { interview: { pace: "faster" } });
  return [a.id, b.id];
}

/** Rows/docs still referencing the user across Postgres and the API's Mongo. */
async function remaining(userId: string, sessionIds: string[]): Promise<number> {
  const pg = await Promise.all([
    env.db.select().from(users).where(eq(users.id, userId)),
    env.db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId)),
    env.db.select().from(authTokens).where(eq(authTokens.userId, userId)),
    env.db.select().from(githubConnections).where(eq(githubConnections.userId, userId)),
    env.db.select().from(leetcodeConnections).where(eq(leetcodeConnections.userId, userId)),
    env.db.select().from(interviewSessions).where(eq(interviewSessions.candidateId, userId)),
  ]);
  const mongo = await Promise.all([
    env.mongo.candidateProfiles.countDocuments({ _id: userId }),
    env.mongo.profileFragments.countDocuments({ userId }),
    env.mongo.sessionOutcomes.countDocuments({ _id: { $in: sessionIds } }),
    env.mongo.userPreferences.countDocuments({ _id: userId }),
  ]);
  return pg.reduce((n, rows) => n + rows.length, 0) + mongo.reduce((n, c) => n + c, 0);
}

function stubUpstreams() {
  env.fetch.on("POST", PURGE, { deleted_plans: 2 });
  env.fetch.on("DELETE", GH_REVOKE, () => status(204));
}

describe("DELETE /users/me", () => {
  it("401 without a token", async () => {
    expect((await env.http.delete(ME).send({ confirmEmail: "x@example.com" })).status).toBe(401);
  });

  it("wipes a password account across every store, purges the AI service and revokes GitHub", async () => {
    const { user, email, refreshToken, token } = await passwordUser();
    const sessionIds = await seed(user.id);
    stubUpstreams();

    const res = await env.http.delete(ME).set("Authorization", token).send({ confirmEmail: `  ${email.toUpperCase()}  `, password: PW });

    expect(res.status).toBe(204);
    expect(setCookies(res)).toMatch(/refresh_token=;/);
    expect(await remaining(user.id, sessionIds)).toBe(0);

    const [purge] = env.fetch.callsTo(PURGE, "POST");
    expect(purge!.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
    expect([...(purge!.json as { session_ids: string[] }).session_ids].sort()).toEqual([...sessionIds].sort());

    const [revoke] = env.fetch.callsTo(GH_REVOKE, "DELETE");
    expect(revoke!.headers.authorization).toBe(`Basic ${Buffer.from("gh-client-id:gh-client-secret").toString("base64")}`);
    expect(revoke!.json).toEqual({ access_token: "gho_secret" });

    expect((await env.http.get(ME).set("Authorization", token)).status).toBe(404);
    expect((await env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${refreshToken}`)).status).toBe(401);
  });

  it("deletes a Google-only account with the typed email alone", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id);
    stubUpstreams();
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(204);
    expect(await remaining(user.id, sessionIds)).toBe(0);
  });

  it("400 confirmation_mismatch for the wrong email, and deletes nothing", async () => {
    const { user, token } = await passwordUser();
    const sessionIds = await seed(user.id);
    const before = await remaining(user.id, sessionIds);
    const res = await env.http.delete(ME).set("Authorization", token).send({ confirmEmail: "someone-else@example.com", password: PW });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("confirmation_mismatch");
    expect(await remaining(user.id, sessionIds)).toBe(before);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it.each([[undefined], ["wrong-password"]])("403 invalid_password for password %j", async (password) => {
    const { user, email, token } = await passwordUser();
    const res = await env.http.delete(ME).set("Authorization", token).send({ confirmEmail: email, password });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("invalid_password");
    expect(await remaining(user.id, [])).toBeGreaterThan(0);
  });

  it("409 interview_in_progress while a session is live", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id, "LIVE_IN_PROGRESS");
    const before = await remaining(user.id, sessionIds);
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("interview_in_progress");
    expect(await remaining(user.id, sessionIds)).toBe(before);
  });

  it("502 deletion_unavailable when the AI service fails, and deletes nothing", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id);
    const before = await remaining(user.id, sessionIds);
    env.fetch.on("POST", PURGE, () => status(503));
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("deletion_unavailable");
    expect(await remaining(user.id, sessionIds)).toBe(before);
    expect(env.fetch.callsTo(GH_REVOKE)).toHaveLength(0);
  });

  it("still deletes when revoking the GitHub grant fails", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id);
    env.fetch.on("POST", PURGE, { deleted_plans: 2 });
    env.fetch.on("DELETE", GH_REVOKE, () => json({ message: "boom" }, 500));
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(204);
    expect(await remaining(user.id, sessionIds)).toBe(0);
  });

  it("skips the AI service when the user has no sessions", async () => {
    const user = await createUser(env);
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(204);
    expect(env.fetch.callsTo(PURGE)).toHaveLength(0);
    expect(await remaining(user.id, [])).toBe(0);
  });

  it("a retry after a partial wipe finishes the job", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id);
    // Simulate a crash after the Mongo step: documents gone, Postgres rows left.
    await env.mongo.candidateProfiles.deleteOne({ _id: user.id });
    await env.mongo.profileFragments.deleteMany({ userId: user.id });
    await env.mongo.sessionOutcomes.deleteMany({ _id: { $in: sessionIds } });
    stubUpstreams();
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(204);
    expect(await remaining(user.id, sessionIds)).toBe(0);
  });

  it("leaves other users' data untouched", async () => {
    const mine = await createUser(env);
    const theirs = await createUser(env);
    await seed(mine.id);
    const theirSessions = await seed(theirs.id);
    const before = await remaining(theirs.id, theirSessions);
    stubUpstreams();
    expect((await env.http.delete(ME).set("Authorization", await bearer(env, mine)).send({ confirmEmail: mine.email })).status).toBe(204);
    expect(await remaining(theirs.id, theirSessions)).toBe(before);
    const theirRows = await env.db.select().from(interviewSessions).where(inArray(interviewSessions.id, theirSessions));
    expect(theirRows).toHaveLength(2);
  });

  it("400 invalid_request when confirmEmail is missing", async () => {
    const user = await createUser(env);
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_request");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountDeletion.test.ts`
Expected: FAIL. Authenticated DELETEs get 404 (no route).

- [ ] **Step 3: AI client** (`apps/api/src/integrations/aiService/client.ts`)

Add `isObject` to the `../../lib/json.js` import. Add a section before `// --- transport`:

```ts
  // --- account deletion ----------------------------------------------------------------------

  /** Drop everything the AI service stores for these sessions (their interview plans). Throws UpstreamError. */
  async purgeUser(sessionIds: string[]): Promise<number> {
    const body = await this.postJson("/users/purge", { session_ids: sessionIds });
    const deleted = isObject(body) ? body.deleted_plans : undefined;
    return typeof deleted === "number" ? deleted : 0;
  }
```

- [ ] **Step 4: GitHub grant revoke** (`apps/api/src/integrations/github/oauth.ts`)

Change the http import to `import { type FetchLike, requestJson, requestText } from "../../lib/http.js";`. Add to `GitHubOAuthService`:

```ts
  /**
   * Account deletion: revoke this OAuth App's grant for the token's user ("Delete an app
   * authorization"), so the app no longer appears in their GitHub settings. Throws on failure.
   */
  async revokeGrant(accessTokenEnc: string): Promise<void> {
    const accessToken = this.tokenCipher.decrypt(accessTokenEnc);
    const basic = Buffer.from(`${this.settings.clientId}:${this.settings.clientSecret}`).toString("base64");
    await requestText(this.fetchImpl, {
      method: "DELETE",
      url: `${this.settings.apiUrl}/applications/${encodeURIComponent(this.settings.clientId)}/grant`,
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ access_token: accessToken }),
      timeoutMs: 10_000,
    });
  }
```

- [ ] **Step 5: Repository deletes**

`apps/api/src/repositories/mongo.ts`:

```ts
// in CandidateProfileRepository
  async deleteByUserId(userId: string): Promise<void> {
    await this.c.candidateProfiles.deleteOne({ _id: userId });
  }

// in ProfileFragmentRepository
  async deleteByUserId(userId: string): Promise<void> {
    await this.c.profileFragments.deleteMany({ userId });
  }

// in SessionOutcomeRepository
  async deleteBySessionIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.c.sessionOutcomes.deleteMany({ _id: { $in: ids } });
  }
```

`apps/api/src/repositories/pg.ts`, in `UserRepository`:

```ts
  /**
   * Account deletion, Postgres half: every row that references the user, then the user — one
   * transaction, user row last. Idempotent (a retry after a partial failure just finishes).
   */
  async deleteCascade(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
      await tx.delete(authTokens).where(eq(authTokens.userId, userId));
      await tx.delete(githubConnections).where(eq(githubConnections.userId, userId));
      await tx.delete(leetcodeConnections).where(eq(leetcodeConnections.userId, userId));
      await tx.delete(interviewSessions).where(eq(interviewSessions.candidateId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
  }
```

(All six tables are already imported in `pg.ts`.)

- [ ] **Step 6: Service** (`apps/api/src/services/accountDeletion.ts`)

```ts
import type { Database } from "../db/pg/client.js";
import type { AiServiceClient } from "../integrations/aiService/client.js";
import type { GitHubOAuthService } from "../integrations/github/oauth.js";
import { errorMessage } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { verifyPassword } from "../lib/password.js";
import type {
  CandidateProfileRepository,
  ProfileFragmentRepository,
  SessionOutcomeRepository,
  UserPreferencesRepository,
} from "../repositories/mongo.js";
import type { GitHubConnectionRepository, InterviewSessionRepository, UserRepository } from "../repositories/pg.js";

export class ConfirmationMismatchError extends Error {}
export class InvalidPasswordError extends Error {}
export class InterviewInProgressError extends Error {}
export class DeletionUnavailableError extends Error {}

/** The AI service's purge accepts at most this many session ids per call. */
const PURGE_BATCH = 1000;

export interface AccountDeletionDeps {
  users: UserRepository;
  sessions: InterviewSessionRepository;
  githubConnections: GitHubConnectionRepository;
  candidateProfiles: CandidateProfileRepository;
  fragments: ProfileFragmentRepository;
  outcomes: SessionOutcomeRepository;
  preferences: UserPreferencesRepository;
  aiService: AiServiceClient;
  githubOAuth: GitHubOAuthService;
  log: Logger;
}

/**
 * "Delete account": an immediate hard delete of everything we hold about the user.
 *
 * Order matters:
 *  1. Checks (typed email, password, no live interview). Nothing is touched if any fails.
 *  2. The AI service (interview plans). A failure aborts BEFORE anything local is deleted.
 *  3. The GitHub grant, best effort.
 *  4. The API's Mongo documents.
 *  5. Postgres in one transaction, user row last.
 * Every step is idempotent and the user row goes last, so a crash mid-way leaves an account that
 * can sign in and simply retry.
 */
export class AccountDeletionService {
  constructor(private readonly d: AccountDeletionDeps) {}

  /** False when the user doesn't exist (already deleted). */
  async delete(userId: string, input: { confirmEmail: string; password?: string }): Promise<boolean> {
    const user = await this.d.users.findById(userId);
    if (!user) return false;

    if (input.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) throw new ConfirmationMismatchError();
    if (user.passwordHash !== null && !(input.password && (await verifyPassword(input.password, user.passwordHash)))) {
      throw new InvalidPasswordError();
    }

    const sessions = await this.d.sessions.findAllByCandidateIdOrderByScheduledAtDesc(userId);
    if (sessions.some((s) => s.status === "LIVE_IN_PROGRESS")) throw new InterviewInProgressError();
    const sessionIds = sessions.map((s) => s.id);

    try {
      for (let i = 0; i < sessionIds.length; i += PURGE_BATCH) {
        await this.d.aiService.purgeUser(sessionIds.slice(i, i + PURGE_BATCH));
      }
    } catch (err) {
      this.d.log.warn({ err: errorMessage(err) }, `account deletion aborted: AI service purge failed userId=${userId}`);
      throw new DeletionUnavailableError();
    }

    const github = await this.d.githubConnections.findByUserId(userId);
    if (github) {
      try {
        await this.d.githubOAuth.revokeGrant(github.accessTokenEnc);
      } catch (err) {
        this.d.log.warn({ err: errorMessage(err) }, `GitHub grant revoke failed during account deletion userId=${userId}`);
      }
    }

    await Promise.all([
      this.d.candidateProfiles.deleteByUserId(userId),
      this.d.fragments.deleteByUserId(userId),
      this.d.outcomes.deleteBySessionIds(sessionIds),
      this.d.preferences.deleteByUserId(userId),
    ]);
    await this.d.users.deleteCascade(userId);
    this.d.log.info(`account deleted userId=${userId}`);
    return true;
  }
}
```

`Database` is unused in this file. Don't import it.

- [ ] **Step 7: Route + wiring**

`apps/api/src/routes/account.ts`. Add imports:

```ts
import { clientIp, enforceRateLimit, rateLimitErrors } from "../http/rateLimit.js";
import {
  ConfirmationMismatchError,
  DeletionUnavailableError,
  InterviewInProgressError,
  InvalidPasswordError,
} from "../services/accountDeletion.js";
```

Add the body schema next to `UpdateUserBody`:

```ts
const DeleteAccountBody = z.object(
  {
    confirmEmail: z.string({ error: "Type your email to confirm." }).min(1, { error: "Type your email to confirm." }).max(254),
    password: z.string().max(128).optional(),
  },
  { error: "The request body must be a JSON object." },
);
```

Add the route inside `accountRouter`. Then replace the final `r.use(routerErrors(() => undefined));` with the mapped version below:

```ts
  /** Immediate hard delete (AccountDeletionService). Password checks share the login rate limit. */
  r.delete("/", async (req, res) => {
    const uid = userId(req);
    const input = parse(DeleteAccountBody, requiredBody(req), "invalid_request");
    enforceRateLimit(c.rateLimiters.loginPerIpEmail, `${clientIp(req)}|delete-account|${uid}`);
    const deleted = await c.accountDeletion.delete(uid, input);
    if (!deleted) {
      res.status(404).end();
      return;
    }
    clearRefreshTokenCookie(res, c.config);
    res.status(204).end();
  });

  r.use(rateLimitErrors);
  r.use(
    routerErrors((err) => {
      if (err instanceof ConfirmationMismatchError) {
        return { status: 400, code: "confirmation_mismatch", message: "The email you typed doesn't match this account." };
      }
      if (err instanceof InvalidPasswordError) return { status: 403, code: "invalid_password", message: "That password isn't right." };
      if (err instanceof InterviewInProgressError) {
        return { status: 409, code: "interview_in_progress", message: "Finish or leave your live interview first." };
      }
      if (err instanceof DeletionUnavailableError) {
        return { status: 502, code: "deletion_unavailable", message: "We couldn't reach every service, so nothing was deleted. Please try again." };
      }
      return undefined;
    }),
  );
```

`apps/api/src/container.ts`: import `AccountDeletionService` from `./services/accountDeletion.js`. After `githubOAuth` and `accountExport` exist:

```ts
  const accountDeletion = new AccountDeletionService({
    users: repos.users,
    sessions: repos.sessions,
    githubConnections: repos.githubConnections,
    candidateProfiles: repos.candidateProfiles,
    fragments: repos.fragments,
    outcomes: repos.outcomes,
    preferences: repos.preferences,
    aiService,
    githubOAuth,
    log,
  });
```

Add `accountDeletion,` to the returned object.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountDeletion.test.ts`
Expected: PASS.

If the password-account test's `remaining()` finds an `auth_token` row written after deletion, the background verify email raced the delete. `passwordUser()` already drains `env.c.background` before seeding; keep that.

- [ ] **Step 9: Full API suite + typecheck**

Run: `pnpm --filter @interviewiq/api exec vitest run && pnpm --filter @interviewiq/api typecheck`
Expected: PASS, no type errors.

---

