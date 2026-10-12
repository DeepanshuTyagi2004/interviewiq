### Task 1: Preferences domain module

**Files:**
- Create: `apps/api/src/domain/preferences.ts`
- Test: `apps/api/test/domain/preferences.test.ts`

**Interfaces:**
- Consumes: `BadRequestError` from `src/lib/errors.ts` (`new BadRequestError(message, code)`).
- Produces:
  - `type Preferences`, `type PreferencesPatch`, `DEFAULT_PREFERENCES: Preferences`
  - `parsePreferencesPatch(body: unknown): PreferencesPatch` (throws `BadRequestError` code `invalid_preferences`)
  - `resolvePreferences(stored: unknown): Preferences`
  - `toSetPaths(patch: PreferencesPatch): Record<string, unknown>`
  - the enum tuples `APP_LANGUAGES`, `DATE_FORMATS`, `TIME_FORMATS`, `WEEK_STARTS`, `INTERVIEW_LANGUAGES`, `INTERVIEWER_VOICES`, `SPEAKING_PACES`, `REMINDER_LEADS`, `LEADERBOARD_VISIBILITY`, `NOTIFICATION_TOPICS`

- [ ] **Step 1: Write the failing test** (`apps/api/test/domain/preferences.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, parsePreferencesPatch, resolvePreferences, toSetPaths } from "../../src/domain/preferences.js";
import { BadRequestError } from "../../src/lib/errors.js";

describe("resolvePreferences", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(resolvePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it("overlays valid stored values and keeps the defaults for the rest", () => {
    const r = resolvePreferences({ interview: { pace: "faster" }, notifications: { email: { weeklyDigest: false } } });
    expect(r.interview.pace).toBe("faster");
    expect(r.interview.voice).toBe("neutral");
    expect(r.notifications.email.weeklyDigest).toBe(false);
    expect(r.notifications.email.debriefReady).toBe(true);
  });

  it("falls back per leaf for stale or invalid stored values and drops unknown keys", () => {
    const r = resolvePreferences({
      _id: "u1",
      updatedAt: new Date(),
      interview: { voice: "robotic", legacy: 1 },
      locale: { timezone: "Mars/Olympus" },
    });
    expect(r.interview.voice).toBe("neutral");
    expect(r.locale.timezone).toBeNull();
    expect(r).not.toHaveProperty("_id");
    expect(r).not.toHaveProperty("updatedAt");
    expect(r.interview).not.toHaveProperty("legacy");
  });
});

describe("parsePreferencesPatch", () => {
  it("accepts partial sections, including timezone null (automatic)", () => {
    expect(parsePreferencesPatch({ locale: { timezone: null } })).toEqual({ locale: { timezone: null } });
    expect(parsePreferencesPatch({ locale: { timezone: "Asia/Kolkata" }, privacy: { shareWithCollege: true } })).toEqual({
      locale: { timezone: "Asia/Kolkata" },
      privacy: { shareWithCollege: true },
    });
    expect(parsePreferencesPatch({})).toEqual({});
  });

  it.each([
    [{ interview: { pace: "warp" } }, "interview.pace"],
    [{ interview: { legacy: true } }, "interview"],
    [{ unknownSection: {} }, ""],
    [{ locale: { timezone: "Mars/Olympus" } }, "locale.timezone"],
    [{ notifications: { email: { weeklyDigest: "yes" } } }, "notifications.email.weeklyDigest"],
    ["not an object", ""],
  ])("rejects %j as invalid_preferences", (body, path) => {
    let caught: unknown;
    try {
      parsePreferencesPatch(body);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestError);
    expect((caught as BadRequestError).code).toBe("invalid_preferences");
    if (path) expect((caught as BadRequestError).message).toContain(path);
  });
});

describe("toSetPaths", () => {
  it("flattens a patch into dotted $set paths, keeping null leaves", () => {
    expect(
      toSetPaths({
        locale: { timezone: null, weekStart: "sunday" },
        notifications: { emailPaused: true, email: { productUpdates: true } },
      }),
    ).toEqual({
      "locale.timezone": null,
      "locale.weekStart": "sunday",
      "notifications.emailPaused": true,
      "notifications.email.productUpdates": true,
    });
  });

  it("is empty for an empty patch", () => {
    expect(toSetPaths({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @interviewiq/api exec vitest run test/domain/preferences.test.ts`
Expected: FAIL. The module `../../src/domain/preferences.js` does not exist.

- [ ] **Step 3: Implement** (`apps/api/src/domain/preferences.ts`)

```ts
import { z } from "zod";
import { BadRequestError } from "../lib/errors.js";

/**
 * Account-level settings (Settings → Preferences / Interview / Notifications / Privacy).
 *
 * Mongo `user_preferences` stores only what the user changed. Reads overlay that on
 * DEFAULT_PREFERENCES leaf by leaf, so adding a setting later needs no migration and a stale stored
 * value (an option removed since) falls back to its default instead of breaking the read.
 * Device-only settings (theme, reduced motion, text size) never reach the server.
 */

export const APP_LANGUAGES = ["en", "hi", "ta", "te", "bn", "mr"] as const;
export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export const TIME_FORMATS = ["12h", "24h"] as const;
export const WEEK_STARTS = ["monday", "sunday"] as const;
export const INTERVIEW_LANGUAGES = ["en", "hinglish", "hi"] as const;
export const INTERVIEWER_VOICES = ["warm", "neutral", "crisp"] as const;
export const SPEAKING_PACES = ["slower", "normal", "faster"] as const;
export const REMINDER_LEADS = ["15m", "1h", "1d"] as const;
export const LEADERBOARD_VISIBILITY = ["name", "anonymous", "hidden"] as const;
export const NOTIFICATION_TOPICS = [
  "interviewReminders",
  "debriefReady",
  "retakeAvailable",
  "targetOpenings",
  "weeklyDigest",
  "productUpdates",
] as const;

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timeZone = z.string().max(64).refine(isTimeZone, { error: "Unknown timezone." });

const channel = z.object({
  interviewReminders: z.boolean(),
  debriefReady: z.boolean(),
  retakeAvailable: z.boolean(),
  targetOpenings: z.boolean(),
  weeklyDigest: z.boolean(),
  productUpdates: z.boolean(),
});

const locale = z.object({
  appLanguage: z.enum(APP_LANGUAGES),
  /** IANA zone, or null = follow the browser ("Automatic"). */
  timezone: timeZone.nullable(),
  dateFormat: z.enum(DATE_FORMATS),
  timeFormat: z.enum(TIME_FORMATS),
  weekStart: z.enum(WEEK_STARTS),
});

const interview = z.object({
  language: z.enum(INTERVIEW_LANGUAGES),
  voice: z.enum(INTERVIEWER_VOICES),
  pace: z.enum(SPEAKING_PACES),
  captions: z.boolean(),
  showTimer: z.boolean(),
  deviceCheck: z.boolean(),
  reminderLead: z.enum(REMINDER_LEADS),
});

const notifications = z.object({ emailPaused: z.boolean(), email: channel, inApp: channel });

const privacy = z.object({
  leaderboardVisibility: z.enum(LEADERBOARD_VISIBILITY),
  shareWithCollege: z.boolean(),
  partnerDiscovery: z.boolean(),
  improveWithMyData: z.boolean(),
});

export const PreferencesSchema = z.object({ locale, interview, notifications, privacy });
export type Preferences = z.infer<typeof PreferencesSchema>;

/** A PATCH body: any subset of leaves. Unknown keys anywhere are rejected. */
const PreferencesPatchSchema = z
  .object({
    locale: locale.partial().strict().optional(),
    interview: interview.partial().strict().optional(),
    notifications: z
      .object({
        emailPaused: z.boolean().optional(),
        email: channel.partial().strict().optional(),
        inApp: channel.partial().strict().optional(),
      })
      .strict()
      .optional(),
    privacy: privacy.partial().strict().optional(),
  })
  .strict();
export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;

/** Privacy-first product defaults (spec §3.1). */
export const DEFAULT_PREFERENCES: Preferences = {
  locale: { appLanguage: "en", timezone: null, dateFormat: "DD/MM/YYYY", timeFormat: "12h", weekStart: "monday" },
  interview: { language: "en", voice: "neutral", pace: "normal", captions: true, showTimer: true, deviceCheck: true, reminderLead: "1h" },
  notifications: {
    emailPaused: false,
    email: { interviewReminders: true, debriefReady: true, retakeAvailable: true, targetOpenings: true, weeklyDigest: true, productUpdates: false },
    inApp: { interviewReminders: true, debriefReady: true, retakeAvailable: true, targetOpenings: true, weeklyDigest: false, productUpdates: false },
  },
  privacy: { leaderboardVisibility: "anonymous", shareWithCollege: false, partnerDiscovery: false, improveWithMyData: false },
};

export function parsePreferencesPatch(body: unknown): PreferencesPatch {
  const r = PreferencesPatchSchema.safeParse(body);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue ? issue.path.map(String).join(".") : "";
  const message = issue?.message ?? "Invalid preferences.";
  throw new BadRequestError(where ? `${where}: ${message}` : message, "invalid_preferences");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Walk the schema: objects recurse, leaves keep the stored value only if it still validates. */
function overlay(schema: z.ZodType, fallback: unknown, stored: unknown): unknown {
  if (schema instanceof z.ZodObject) {
    const src = isRecord(stored) ? stored : {};
    const base = fallback as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(schema.shape as Record<string, z.ZodType>).map(([key, child]) => [key, overlay(child, base[key], src[key])]),
    );
  }
  return schema.safeParse(stored).success ? stored : fallback;
}

export function resolvePreferences(stored: unknown): Preferences {
  return overlay(PreferencesSchema, DEFAULT_PREFERENCES, stored) as Preferences;
}

/** `{ locale: { timezone: null } }` → `{ "locale.timezone": null }`, for a Mongo `$set`. */
export function toSetPaths(patch: PreferencesPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (isRecord(value)) walk(value, path);
      else out[path] = value;
    }
  };
  walk(patch as Record<string, unknown>, "");
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @interviewiq/api exec vitest run test/domain/preferences.test.ts`
Expected: PASS (all tests).

If zod rejects `.partial().strict()` (it shouldn't; zod 4 keeps `.strict()` as a legacy alias), swap each `x.partial().strict()` for `z.strictObject(x.partial().shape)`. The test is the arbiter.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @interviewiq/api typecheck`
Expected: no errors.

---

