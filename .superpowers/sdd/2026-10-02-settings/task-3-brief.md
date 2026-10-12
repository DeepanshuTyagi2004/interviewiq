### Task 3: Display name, sign-out everywhere, `hasGoogle`, Google keeps the chosen name

**Files:**
- Modify: `apps/api/src/repositories/pg.ts` (`UserRepository.updateName`; `upsertByGoogleSub` stops overwriting `name`)
- Modify: `apps/api/src/services/userService.ts` (`rename`, `hasGoogle`)
- Modify: `apps/api/src/auth/refreshTokens.ts` (`revokeAll`)
- Modify: `apps/api/src/routes/auth.ts` (export `clearRefreshTokenCookie`)
- Modify: `apps/api/src/routes/account.ts` (`PATCH /`, `POST /sessions/revoke`)
- Modify tests: `apps/api/test/app.test.ts:64-72`, `apps/api/test/routes/passwordAuthController.test.ts:62-70` (add `hasGoogle`)
- Test: `apps/api/test/routes/accountController.test.ts` (append)

**Interfaces:**
- Consumes: `accountRouter` (Task 2); `RefreshTokenRepository.revokeAllForUser(userId, now)` (exists).
- Produces:
  - `UserRepository.updateName(id: string, name: string): Promise<UserRow | null>`
  - `UserService.rename(id: string, name: string): Promise<UserRow | null>`
  - `UserResponse.hasGoogle: boolean`
  - `RefreshTokenService.revokeAll(userId: string): Promise<void>`
  - `clearRefreshTokenCookie(res: Response, config: Pick<Config, "cookieSecure" | "cookieSameSite">): void` exported from `routes/auth.ts`

- [ ] **Step 1: Write the failing tests** (append to `apps/api/test/routes/accountController.test.ts`; add `import { randomUUID } from "node:crypto";` and `import type { Response } from "supertest";` at the top)

```ts
const PW = "correct-horse-battery";
const uniqueEmail = (p: string) => `${p}-${randomUUID().slice(0, 8)}@example.com`;
function setCookies(res: Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  return ([] as string[]).concat(raw ?? []).join(";");
}
const refreshCookie = (res: Response) => /refresh_token=([^;]*)/.exec(setCookies(res))?.[1] ?? "";
const refresh = (cookie: string) => env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${cookie}`);

describe("PATCH /users/me (display name)", () => {
  it("renames, trimmed, and /users/me shows it", async () => {
    const { token } = await auth();
    const res = await env.http.patch("/api/v1/users/me").set("Authorization", token).send({ name: "  Asha R.  " });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Asha R.");
    expect((await env.http.get("/api/v1/users/me").set("Authorization", token)).body.name).toBe("Asha R.");
  });

  it.each([{ name: "" }, { name: "   " }, { name: "x".repeat(81) }, { name: 42 }, {}])("400 invalid_name for %j", async (body) => {
    const { token } = await auth();
    const res = await env.http.patch("/api/v1/users/me").set("Authorization", token).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_name");
  });

  it("a later Google sign-in keeps the renamed display name", async () => {
    const email = uniqueEmail("g");
    const sub = `g-${randomUUID()}`;
    const google = await env.c.users.upsertFromGoogle({ sub, email, name: "Google Name", emailVerified: true });
    await env.http.patch("/api/v1/users/me").set("Authorization", await bearer(env, google)).send({ name: "Chosen Name" });
    const again = await env.c.users.upsertFromGoogle({ sub, email, name: "Google Name", emailVerified: true });
    expect(again.name).toBe("Chosen Name");
  });
});

describe("hasGoogle on /users/me", () => {
  it("is true for Google accounts and false for password-only ones", async () => {
    const g = await createUser(env);
    expect((await env.http.get("/api/v1/users/me").set("Authorization", await bearer(env, g))).body.hasGoogle).toBe(true);
    const { user } = await env.c.passwordAuth.register({ name: "P", email: uniqueEmail("p"), password: PW });
    expect((await env.http.get("/api/v1/users/me").set("Authorization", await bearer(env, user))).body.hasGoogle).toBe(false);
  });
});

describe("POST /users/me/sessions/revoke", () => {
  it("revokes every refresh token of the user and clears the cookie", async () => {
    const email = uniqueEmail("s");
    const first = await env.c.passwordAuth.register({ name: "S", email, password: PW });
    const login = await env.http.post("/api/v1/auth/login").send({ email, password: PW });
    const secondCookie = refreshCookie(login);
    expect(secondCookie).not.toBe("");

    const res = await env.http.post("/api/v1/users/me/sessions/revoke").set("Authorization", await bearer(env, first.user));
    expect(res.status).toBe(204);
    expect(setCookies(res)).toMatch(/refresh_token=;/);
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await refresh(secondCookie)).status).toBe(401);
  });

  it("leaves other users' sessions alone", async () => {
    const mine = await env.c.passwordAuth.register({ name: "A", email: uniqueEmail("a"), password: PW });
    const theirs = await env.c.passwordAuth.register({ name: "B", email: uniqueEmail("b"), password: PW });
    await env.http.post("/api/v1/users/me/sessions/revoke").set("Authorization", await bearer(env, mine.user));
    expect((await refresh(theirs.refreshToken)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountController.test.ts`
Expected:
- the new PATCH/revoke tests FAIL with 404s;
- the Google-name test FAILS ("Google Name" ≠ "Chosen Name");
- `hasGoogle` is undefined.

- [ ] **Step 3: Repository changes** (`apps/api/src/repositories/pg.ts`)

In `upsertByGoogleSub`'s `onConflictDoUpdate.set`, **remove** the `name: input.name,` line. Add a comment line above `set:`:

```ts
        // `name` is set once, at sign-up: afterwards it's the user's own display name (Settings → Account).
```

Add to `UserRepository` (after `markOnboardingComplete`):

```ts
  updateName(id: string, name: string): Promise<UserRow | null> {
    return this.db.update(users).set({ name }).where(eq(users.id, id)).returning().then(one);
  }
```

- [ ] **Step 4: Service changes** (`apps/api/src/services/userService.ts`)

Add to `UserResponse` after `hasPassword`:

```ts
  /** A Google account is linked (can sign in with Google). */
  hasGoogle: boolean;
```

Add to `toUserResponse`: `hasGoogle: u.googleSub !== null,`

Add to `UserService` (after `updateRole`):

```ts
  rename(id: string, name: string): Promise<UserRow | null> {
    return this.users.updateName(id, name);
  }
```

- [ ] **Step 5: `revokeAll`** (`apps/api/src/auth/refreshTokens.ts`, inside `RefreshTokenService`, after `revoke`)

```ts
  /** "Log out of all devices": revoke every live refresh token the user has. */
  async revokeAll(userId: string): Promise<void> {
    await new RefreshTokenRepository(this.db).revokeAllForUser(userId, new Date());
  }
```

`RefreshTokenRepository` is already imported there; if not, import it from `../repositories/pg.js`.

- [ ] **Step 6: Export the cookie-clearing helper** (`apps/api/src/routes/auth.ts`)

Add `import type { Config } from "../config.js";` and, below the cookie constants:

```ts
/** Expire the refresh cookie (same attributes it was set with). Shared with the account routes. */
export function clearRefreshTokenCookie(res: Response, config: Pick<Config, "cookieSecure" | "cookieSameSite">): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite, path: REFRESH_COOKIE_PATH });
}
```

Inside `authRouter`, replace the body of the local `clearRefreshCookie` with `clearRefreshTokenCookie(res, config)`:

```ts
  const clearRefreshCookie = (res: Response) => clearRefreshTokenCookie(res, config);
```

- [ ] **Step 7: Routes** (`apps/api/src/routes/account.ts`)

Add imports:

```ts
import { z } from "zod";
import { BadRequestError } from "../lib/errors.js";
import { toUserResponse } from "../services/userService.js";
import { clearRefreshTokenCookie } from "./auth.js";
```

Add above `accountRouter`:

```ts
const UpdateUserBody = z.object(
  {
    name: z
      .string({ error: "Enter your name." })
      .trim()
      .min(1, { error: "Enter your name." })
      .max(80, { error: "Name must be at most 80 characters." }),
  },
  { error: "The request body must be a JSON object." },
);

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestError(r.error.issues[0]?.message ?? "Invalid request.", code);
  return r.data;
}
```

Add inside `accountRouter` (before `r.use(routerErrors…)`):

```ts
  /** Display name. Google sign-ins no longer overwrite it (UserRepository.upsertByGoogleSub). */
  r.patch("/", async (req, res) => {
    const { name } = parse(UpdateUserBody, requiredBody(req), "invalid_name");
    const user = await c.users.rename(userId(req), name);
    if (!user) {
      res.status(404).end();
      return;
    }
    res.json(toUserResponse(user));
  });

  /** "Log out of all devices" — this one included. */
  r.post("/sessions/revoke", async (req, res) => {
    await c.refreshTokens.revokeAll(userId(req));
    clearRefreshTokenCookie(res, c.config);
    res.status(204).end();
  });
```

- [ ] **Step 8: Update the two exact-shape assertions**

- `apps/api/test/app.test.ts`, the `GET /users/me returns the current user` `toEqual`: add `hasGoogle: true,` (that user comes from `createUser`, a Google upsert).
- `apps/api/test/routes/passwordAuthController.test.ts`, the register test's `toEqual`: add `hasGoogle: false,`.
- Any other exact `toEqual` on a user response (e.g. the admin users list in `adminCompanyController`/admin tests): add `hasGoogle` with the right value. Find them with `grep -rn "hasPassword:" apps/api/test`.

- [ ] **Step 9: Run the API suite**

Run: `pnpm --filter @interviewiq/api exec vitest run`
Expected: PASS.

If a Google-linking test asserted that a later Google login refreshes `name`, it now contradicts the approved behaviour. Change that assertion to expect the original name, and note it in the hand-off.

- [ ] **Step 10: Typecheck**

Run: `pnpm --filter @interviewiq/api typecheck`
Expected: no errors.

---

