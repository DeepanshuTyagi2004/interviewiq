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
