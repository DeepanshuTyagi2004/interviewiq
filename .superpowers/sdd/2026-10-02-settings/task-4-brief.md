### Task 4: Data export (`GET /users/me/export`)

**Files:**
- Modify: `apps/api/src/repositories/mongo.ts` (`SessionOutcomeRepository.findBySessionIds`)
- Create: `apps/api/src/services/accountExport.ts`
- Modify: `apps/api/src/routes/account.ts`, `apps/api/src/container.ts`
- Test: `apps/api/test/routes/accountExport.test.ts`

**Interfaces:**
- Consumes: `PreferencesService.get` (Task 2), `toUserResponse` (Task 3).
- Produces:
  - `AccountExportService.export(userId): Promise<AccountExport | null>`
  - container key `c.accountExport`
  - `SessionOutcomeRepository.findBySessionIds(ids: string[]): Promise<SessionOutcomeDoc[]>`

- [ ] **Step 1: Write the failing test** (`apps/api/test/routes/accountExport.test.ts`)

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../../src/db/pg/schema.js";
import { bearer, createTestEnv, type TestEnv } from "../support/harness.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());

const PW = "correct-horse-battery";
const EXPORT = "/api/v1/users/me/export";

async function seededUser() {
  const email = `x-${randomUUID().slice(0, 8)}@example.com`;
  const { user } = await env.c.passwordAuth.register({ name: "Asha", email, password: PW });
  await env.c.repos.candidateProfiles.save({
    userId: user.id, fullName: "Asha Rao", email, phone: null, location: "Delhi", headline: null, targetRole: null, targetJdId: null,
    education: [], experience: [], projects: [], skills: ["Python"], achievements: [],
    detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: "resume.pdf", resumeParsedAt: null,
  });
  await env.c.repos.githubConnections.upsert({ userId: user.id, githubLogin: "asha", accessTokenEnc: "ENC-SECRET-TOKEN", scope: "read:user" });
  await env.c.repos.leetcodeConnections.upsertSyncing(user.id, "asha_lc");
  await env.c.repos.fragments.insert({ userId: user.id, source: "LEETCODE", data: { solved: { total: 412 } }, contentHash: "h1", version: 1, fetchedAt: new Date() });
  const session = await env.c.repos.sessions.insert({
    candidateId: user.id, jobDescriptionId: randomUUID(), company: "meesho", role: "software-engineer", level: "sde1",
    roundType: "dsa", scheduledAt: new Date(), timezone: "Asia/Kolkata",
  });
  await env.c.repos.outcomes.save(session.id, { verdict: "lean_hire" });
  await env.c.preferences.update(user.id, { interview: { pace: "faster" } });
  return { user, session };
}

describe("GET /users/me/export", () => {
  it("401 without a token", async () => {
    expect((await env.http.get(EXPORT)).status).toBe(401);
  });

  it("returns everything the API holds about the user as a JSON attachment", async () => {
    const { user, session } = await seededUser();
    const res = await env.http.get(EXPORT).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="interviewiq-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.body.user).toMatchObject({ id: user.id, email: user.email, hasPassword: true });
    expect(res.body.preferences.interview.pace).toBe("faster");
    expect(res.body.candidateProfile).toMatchObject({ fullName: "Asha Rao", skills: ["Python"] });
    expect(res.body.candidateProfile).not.toHaveProperty("_id");
    expect(res.body.connections.github).toMatchObject({ login: "asha", scope: "read:user" });
    expect(res.body.connections.leetcode).toMatchObject({ username: "asha_lc" });
    expect(res.body.profileFragments).toEqual([expect.objectContaining({ source: "LEETCODE", data: { solved: { total: 412 } } })]);
    expect(res.body.interviewSessions).toEqual([expect.objectContaining({ id: session.id, company: "meesho" })]);
    expect(res.body.sessionOutcomes).toEqual([expect.objectContaining({ sessionId: session.id, outcome: { verdict: "lean_hire" } })]);
    expect(res.body.notes).toEqual([expect.stringContaining("Interview plans")]);
  });

  it("never includes secrets", async () => {
    const { user } = await seededUser();
    const [row] = await env.db.select().from(users).where(eq(users.id, user.id));
    const text = JSON.stringify((await env.http.get(EXPORT).set("Authorization", await bearer(env, user))).body);
    expect(text).not.toContain("ENC-SECRET-TOKEN");
    expect(text).not.toContain(row!.passwordHash!);
    expect(text).not.toMatch(/passwordHash|accessTokenEnc|tokenHash|googleSub/);
  });

  it("works for a user with nothing connected", async () => {
    const { user } = await env.c.passwordAuth.register({ name: "New", email: `n-${randomUUID().slice(0, 8)}@example.com`, password: PW });
    const res = await env.http.get(EXPORT).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      candidateProfile: null,
      connections: { github: null, leetcode: null },
      profileFragments: [],
      interviewSessions: [],
      sessionOutcomes: [],
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountExport.test.ts`
Expected: FAIL. The authenticated tests get 404 (route missing).

- [ ] **Step 3: Repository helper** (`apps/api/src/repositories/mongo.ts`, inside `SessionOutcomeRepository`)

```ts
  findBySessionIds(ids: string[]): Promise<SessionOutcomeDoc[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.c.sessionOutcomes.find({ _id: { $in: ids } }).toArray();
  }
```

- [ ] **Step 4: Service** (`apps/api/src/services/accountExport.ts`)

```ts
import type { CandidateProfileDoc } from "../db/mongo/client.js";
import type { InterviewSessionRow } from "../db/pg/schema.js";
import type { CandidateProfileRepository, ProfileFragmentRepository, SessionOutcomeRepository } from "../repositories/mongo.js";
import type {
  GitHubConnectionRepository,
  InterviewSessionRepository,
  LeetCodeConnectionRepository,
  UserRepository,
} from "../repositories/pg.js";
import type { PreferencesResponse, PreferencesService } from "./preferencesService.js";
import { toUserResponse, type UserResponse } from "./userService.js";

const PLANS_NOTE = "Interview plans generated by the AI service are not included in this export.";

export interface AccountExport {
  exportedAt: string;
  notes: string[];
  user: UserResponse & { createdAt: string };
  preferences: PreferencesResponse;
  candidateProfile: Omit<CandidateProfileDoc, "_id"> | null;
  connections: {
    github: { login: string; scope: string; connectedAt: Date; lastRefreshedAt: Date | null; status: string | null } | null;
    leetcode: { username: string; status: string; connectedAt: Date; lastRefreshedAt: Date | null } | null;
  };
  profileFragments: { source: string; data: Record<string, unknown>; version: number; fetchedAt: Date }[];
  interviewSessions: InterviewSessionRow[];
  sessionOutcomes: { sessionId: string; outcome: Record<string, unknown>; receivedAt: Date }[];
}

function withoutId<T extends { _id: unknown }>(doc: T): Omit<T, "_id"> {
  const copy: Partial<T> = { ...doc };
  delete copy._id;
  return copy as Omit<T, "_id">;
}

/** "Export my data": everything this API stores about the user, minus secrets (hashes, tokens, Google subject). */
export class AccountExportService {
  constructor(
    private readonly users: UserRepository,
    private readonly preferences: PreferencesService,
    private readonly candidateProfiles: CandidateProfileRepository,
    private readonly github: GitHubConnectionRepository,
    private readonly leetcode: LeetCodeConnectionRepository,
    private readonly fragments: ProfileFragmentRepository,
    private readonly sessions: InterviewSessionRepository,
    private readonly outcomes: SessionOutcomeRepository,
  ) {}

  async export(userId: string): Promise<AccountExport | null> {
    const user = await this.users.findById(userId);
    if (!user) return null;
    const [preferences, profile, github, leetcode, fragments, sessions] = await Promise.all([
      this.preferences.get(userId),
      this.candidateProfiles.findByUserId(userId),
      this.github.findByUserId(userId),
      this.leetcode.findByUserId(userId),
      this.fragments.findByUserId(userId),
      this.sessions.findAllByCandidateIdOrderByScheduledAtDesc(userId),
    ]);
    const outcomes = await this.outcomes.findBySessionIds(sessions.map((s) => s.id));

    return {
      exportedAt: new Date().toISOString(),
      notes: [PLANS_NOTE],
      user: { ...toUserResponse(user), createdAt: user.createdAt.toISOString() },
      preferences,
      candidateProfile: profile ? withoutId(profile) : null,
      connections: {
        github: github
          ? { login: github.githubLogin, scope: github.scope, connectedAt: github.connectedAt, lastRefreshedAt: github.lastRefreshedAt, status: github.status }
          : null,
        leetcode: leetcode
          ? { username: leetcode.username, status: leetcode.status, connectedAt: leetcode.connectedAt, lastRefreshedAt: leetcode.lastRefreshedAt }
          : null,
      },
      profileFragments: fragments.map((f) => ({ source: f.source, data: f.data, version: f.version, fetchedAt: f.fetchedAt })),
      interviewSessions: sessions,
      sessionOutcomes: outcomes.map((o) => ({ sessionId: o._id, outcome: o.outcome, receivedAt: o.receivedAt })),
    };
  }
}
```

- [ ] **Step 5: Route + wiring**

`apps/api/src/routes/account.ts`, inside `accountRouter` before `r.use(...)`:

```ts
  /** Settings → Privacy & data → Export: a JSON attachment of everything the API holds. */
  r.get("/export", async (req, res) => {
    const data = await c.accountExport.export(userId(req));
    if (!data) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="interviewiq-export-${data.exportedAt.slice(0, 10)}.json"`);
    res.json(data);
  });
```

`apps/api/src/container.ts`: import `AccountExportService` from `./services/accountExport.js`. After `preferences`:

```ts
  const accountExport = new AccountExportService(
    repos.users,
    preferences,
    repos.candidateProfiles,
    repos.githubConnections,
    repos.leetcodeConnections,
    repos.fragments,
    repos.sessions,
    repos.outcomes,
  );
```

Add `accountExport,` to the returned object.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountExport.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @interviewiq/api typecheck`
Expected: no errors.

---

