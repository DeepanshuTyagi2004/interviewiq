### Task 2: Preferences endpoints (Mongo collection, repository, service, router)

**Files:**
- Modify: `apps/api/src/db/mongo/client.ts` (doc type + collection)
- Modify: `apps/api/src/repositories/mongo.ts` (new repository)
- Create: `apps/api/src/services/preferencesService.ts`
- Create: `apps/api/src/routes/account.ts`
- Modify: `apps/api/src/app.ts` (mount)
- Modify: `apps/api/src/container.ts` (wire)
- Test: `apps/api/test/routes/accountController.test.ts`

**Interfaces:**
- Consumes (Task 1): `parsePreferencesPatch`, `resolvePreferences`, `toSetPaths`, `Preferences`, `DEFAULT_PREFERENCES`.
- Produces:
  - `UserPreferencesDoc` and `MongoCollections.userPreferences`
  - `UserPreferencesRepository { findByUserId(userId): Promise<UserPreferencesDoc | null>; setPaths(userId, paths, now): Promise<UserPreferencesDoc>; deleteByUserId(userId): Promise<void> }`
  - `PreferencesService { get(userId): Promise<PreferencesResponse>; update(userId, body: unknown): Promise<PreferencesResponse> }` with `type PreferencesResponse = Preferences & { updatedAt: string | null }`
  - `accountRouter(c: Container): Router` mounted at `/api/v1/users/me`
  - container keys `c.repos.preferences`, `c.preferences`

- [ ] **Step 1: Write the failing test** (`apps/api/test/routes/accountController.test.ts`)

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../../src/domain/preferences.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";

/** Settings endpoints under /api/v1/users/me (preferences, name, sessions). */

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());

const PREFS = "/api/v1/users/me/preferences";

async function auth() {
  const user = await createUser(env);
  return { user, token: await bearer(env, user) };
}

describe("GET/PATCH /users/me/preferences", () => {
  it("401 without a token", async () => {
    expect((await env.http.get(PREFS)).status).toBe(401);
    expect((await env.http.patch(PREFS).send({})).status).toBe(401);
  });

  it("returns the defaults, with updatedAt null, before anything is saved", async () => {
    const { token } = await auth();
    const res = await env.http.get(PREFS).set("Authorization", token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULT_PREFERENCES, updatedAt: null });
  });

  it("PATCH changes only the sent leaves and persists them", async () => {
    const { token } = await auth();
    const first = await env.http.patch(PREFS).set("Authorization", token).send({ interview: { pace: "faster" } });
    expect(first.status).toBe(200);
    expect(first.body.interview).toEqual({ ...DEFAULT_PREFERENCES.interview, pace: "faster" });
    expect(typeof first.body.updatedAt).toBe("string");

    const second = await env.http
      .patch(PREFS)
      .set("Authorization", token)
      .send({ interview: { captions: false }, notifications: { email: { productUpdates: true } }, locale: { timezone: "Asia/Kolkata" } });
    expect(second.status).toBe(200);

    const read = await env.http.get(PREFS).set("Authorization", token);
    expect(read.body.interview).toEqual({ ...DEFAULT_PREFERENCES.interview, pace: "faster", captions: false });
    expect(read.body.notifications.email).toEqual({ ...DEFAULT_PREFERENCES.notifications.email, productUpdates: true });
    expect(read.body.notifications.inApp).toEqual(DEFAULT_PREFERENCES.notifications.inApp);
    expect(read.body.locale.timezone).toBe("Asia/Kolkata");
  });

  it("can set the timezone back to automatic (null)", async () => {
    const { token } = await auth();
    await env.http.patch(PREFS).set("Authorization", token).send({ locale: { timezone: "Europe/London" } });
    const res = await env.http.patch(PREFS).set("Authorization", token).send({ locale: { timezone: null } });
    expect(res.status).toBe(200);
    expect(res.body.locale.timezone).toBeNull();
  });

  it("keeps each user's preferences separate", async () => {
    const a = await auth();
    const b = await auth();
    await env.http.patch(PREFS).set("Authorization", a.token).send({ privacy: { shareWithCollege: true } });
    expect((await env.http.get(PREFS).set("Authorization", b.token)).body.privacy.shareWithCollege).toBe(false);
  });

  it.each([
    { interview: { pace: "warp" } },
    { privacy: { leaderboardVisibility: "public" } },
    { locale: { timezone: "Mars/Olympus" } },
    { theme: "dark" },
    { notifications: { sms: { debriefReady: true } } },
  ])("400 invalid_preferences for %j", async (body) => {
    const { token } = await auth();
    const res = await env.http.patch(PREFS).set("Authorization", token).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_preferences");
  });

  it("400 when the PATCH body is missing", async () => {
    const { token } = await auth();
    expect((await env.http.patch(PREFS).set("Authorization", token)).status).toBe(400);
  });

  it("does not shadow the existing /users/me routes", async () => {
    const { token } = await auth();
    expect((await env.http.get("/api/v1/users/me").set("Authorization", token)).status).toBe(200);
    expect((await env.http.get("/api/v1/users/me/candidate-profile").set("Authorization", token)).status).toBe(204);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountController.test.ts`
Expected: FAIL. The preferences tests get 404 `not_found` (no such endpoint).

- [ ] **Step 3: Add the document type + collection** (`apps/api/src/db/mongo/client.ts`)

Add `user_preferences` to the file's top doc comment list:

```ts
 *   user_preferences    one per user (_id = userId) — only the settings the user changed; reads
 *                       overlay them on DEFAULT_PREFERENCES (domain/preferences.ts)
```

Add after `SessionOutcomeDoc`:

```ts
export interface UserPreferencesDoc {
  _id: string;
  /** Partial sections: only the leaves the user changed. Validated on every read. */
  locale?: Record<string, unknown>;
  interview?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  privacy?: Record<string, unknown>;
  updatedAt: Date;
}
```

Extend `MongoCollections` and `collections()`:

```ts
export interface MongoCollections {
  candidateProfiles: Collection<CandidateProfileDoc>;
  profileFragments: Collection<ProfileFragmentDoc>;
  sessionOutcomes: Collection<SessionOutcomeDoc>;
  userPreferences: Collection<UserPreferencesDoc>;
}

export function collections(db: Db): MongoCollections {
  return {
    candidateProfiles: db.collection<CandidateProfileDoc>("candidate_profiles"),
    profileFragments: db.collection<ProfileFragmentDoc>("profile_fragments"),
    sessionOutcomes: db.collection<SessionOutcomeDoc>("session_outcomes"),
    userPreferences: db.collection<UserPreferencesDoc>("user_preferences"),
  };
}
```

- [ ] **Step 4: Add the repository** (append to `apps/api/src/repositories/mongo.ts`)

Add `UserPreferencesDoc` to the type import from `../db/mongo/client.js`, add `import type { UpdateFilter } from "mongodb";` at the top, then append:

```ts
export class UserPreferencesRepository {
  constructor(private readonly c: MongoCollections) {}

  findByUserId(userId: string): Promise<UserPreferencesDoc | null> {
    return this.c.userPreferences.findOne({ _id: userId });
  }

  /** Upsert only the given dotted leaves (`"interview.pace"`), so concurrent edits of different settings never clobber each other. */
  async setPaths(userId: string, paths: Record<string, unknown>, now: Date): Promise<UserPreferencesDoc> {
    const update = { $set: { ...paths, updatedAt: now } } as UpdateFilter<UserPreferencesDoc>;
    const saved = await this.c.userPreferences.findOneAndUpdate({ _id: userId }, update, { upsert: true, returnDocument: "after" });
    return saved!;
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.c.userPreferences.deleteOne({ _id: userId });
  }
}
```

- [ ] **Step 5: Add the service** (`apps/api/src/services/preferencesService.ts`)

```ts
import { parsePreferencesPatch, resolvePreferences, toSetPaths, type Preferences } from "../domain/preferences.js";
import type { UserPreferencesRepository } from "../repositories/mongo.js";

/** The wire shape: every setting resolved, plus when the user last changed one (null = never). */
export type PreferencesResponse = Preferences & { updatedAt: string | null };

export class PreferencesService {
  constructor(private readonly repo: UserPreferencesRepository) {}

  async get(userId: string): Promise<PreferencesResponse> {
    const doc = await this.repo.findByUserId(userId);
    return { ...resolvePreferences(doc), updatedAt: doc ? doc.updatedAt.toISOString() : null };
  }

  /** Validate a partial patch (400 invalid_preferences), persist only its leaves, return the full set. */
  async update(userId: string, body: unknown): Promise<PreferencesResponse> {
    const paths = toSetPaths(parsePreferencesPatch(body));
    if (Object.keys(paths).length === 0) return this.get(userId);
    const doc = await this.repo.setPaths(userId, paths, new Date());
    return { ...resolvePreferences(doc), updatedAt: doc.updatedAt.toISOString() };
  }
}
```

- [ ] **Step 6: Add the router** (`apps/api/src/routes/account.ts`)

```ts
import type { Router } from "express";
import type { Container } from "../container.js";
import { requiredBody, router, routerErrors, userId } from "../http/support.js";

/**
 * Settings under /api/v1/users/me: preferences, display name, sessions, data export and account
 * deletion. Mounted before the candidate-profile and users routers; paths it doesn't own fall
 * through to them.
 */
export function accountRouter(c: Container): Router {
  const r = router();

  r.get("/preferences", async (req, res) => {
    res.json(await c.preferences.get(userId(req)));
  });

  r.patch("/preferences", async (req, res) => {
    res.json(await c.preferences.update(userId(req), requiredBody(req)));
  });

  r.use(routerErrors(() => undefined));
  return r;
}
```

- [ ] **Step 7: Mount it and wire the container**

`apps/api/src/app.ts`: import `accountRouter` from `./routes/account.js` and mount it **first** under `/users/me`:

```ts
  const v1 = router();
  v1.use("/users/me", accountRouter(c));
  v1.use("/users/me", candidateProfileRouter(c));
  v1.use("/users", usersRouter(c));
```

`apps/api/src/container.ts`:
- Import `UserPreferencesRepository` alongside the other Mongo repositories, and `PreferencesService` from `./services/preferencesService.js`.
- Add `preferences: new UserPreferencesRepository(mongo),` to `repos`.
- After `const users = …` add `const preferences = new PreferencesService(repos.preferences);`.
- Add `preferences,` to the returned object.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountController.test.ts test/routes/candidateProfileController.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @interviewiq/api typecheck`
Expected: no errors.

---

