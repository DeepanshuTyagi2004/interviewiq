import type { CodingPlatform, ProfileSource } from "../../domain/enums.js";
import { canonicalize, sha256Hex } from "../../lib/canonicalJson.js";
import { type FetchLike, requestText, UpstreamHttpError } from "../../lib/http.js";
import type { ProfileFragmentRepository } from "../../repositories/mongo.js";

/**
 * Shared pieces of the handle-based coding-platform collectors (analyzer specs:
 * `docs/sources/platform-analyzers.md`). Each collector reads public data for a handle and returns a
 * minimized fragment; the shared job stores it with hash-skip and records the sync status.
 */

export const PLATFORM_REASONS = {
  /** The handle does not exist on the platform. → 404 */
  NOT_FOUND: "platform_user_not_found",
  /** The handle (or pasted URL) is not a valid handle for the platform. → 400 */
  INVALID_HANDLE: "platform_handle_invalid",
  /** The platform was unreachable, rate-limited us or changed its response. → 503 */
  UNREACHABLE: "platform_unreachable",
} as const;
export type PlatformReason = keyof typeof PLATFORM_REASONS;

export class PlatformProfileError extends Error {
  constructor(readonly reason: PlatformReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlatformProfileError";
  }
  get code(): string { return PLATFORM_REASONS[this.reason]; }
  get httpStatus(): number { return this.reason === "NOT_FOUND" ? 404 : this.reason === "INVALID_HANDLE" ? 400 : 503; }
}

/** A handle another profile links to (TUF lists the user's other platforms). */
export interface LinkedProfile { platform: CodingPlatform | "LEETCODE"; handle: string }
export interface PlatformSnapshot { data: Record<string, unknown>; linkedProfiles: LinkedProfile[] }

export interface PlatformCollector {
  readonly platform: CodingPlatform;
  /** Cheap existence check used on connect; throws PlatformProfileError("NOT_FOUND") for an unknown handle. */
  validate(handle: string): Promise<void>;
  /** Fetch and minimize; throws PlatformProfileError. */
  collect(handle: string, now: Date): Promise<PlatformSnapshot>;
}

/** Profile-URL shape and handle grammar per platform (pasted URLs and "@handle" are accepted). */
const HANDLES: Record<CodingPlatform | "LEETCODE", { url: RegExp; handle: RegExp }> = {
  CODEFORCES: { url: /^(?:https?:\/\/)?(?:www\.|m\d?\.)?codeforces\.com\/profile\/([^/?#\s]+)/i, handle: /^[A-Za-z0-9_.-]{2,24}$/ },
  ATCODER: { url: /^(?:https?:\/\/)?(?:www\.)?atcoder\.jp\/users\/([^/?#\s]+)/i, handle: /^[A-Za-z0-9_]{2,16}$/ },
  CODECHEF: { url: /^(?:https?:\/\/)?(?:www\.)?codechef\.com\/users\/([^/?#\s]+)/i, handle: /^[A-Za-z0-9_.]{2,40}$/ },
  TUF: { url: /^(?:https?:\/\/)?(?:www\.)?takeuforward\.org\/(?:profile|plus\/profile)\/([^/?#\s]+)/i, handle: /^[A-Za-z0-9_.-]{2,40}$/ },
  LEETCODE: { url: /^(?:https?:\/\/)?(?:www\.)?leetcode\.(?:com|cn)\/(?:u\/)?([^/?#\s]+)/i, handle: /^[A-Za-z0-9_-]{1,40}$/ },
};

/** Bare handle from a handle, "@handle" or a pasted profile URL; null when it is not a valid handle. */
export function normalizePlatformHandle(platform: CodingPlatform | "LEETCODE", raw: string | null | undefined): string | null {
  let value = (raw ?? "").trim();
  const match = HANDLES[platform].url.exec(value);
  if (match) value = decodeURIComponent(match[1]!);
  value = value.replace(/^@/, "").trim();
  return HANDLES[platform].handle.test(value) ? value : null;
}

const LINK_PLATFORMS: [RegExp, CodingPlatform | "LEETCODE"][] = [
  [/^leet\s*code$/i, "LEETCODE"], [/^code\s*forces$/i, "CODEFORCES"], [/^code\s*chef$/i, "CODECHEF"], [/^at\s*coder$/i, "ATCODER"],
];

/** Linked profiles from {platform, profile_link} rows; empty or foreign links are ignored. */
export function linkedProfilesFrom(rows: unknown): LinkedProfile[] {
  const out = new Map<string, LinkedProfile>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const label = typeof value.platform === "string" ? value.platform.trim() : "", link = typeof value.profile_link === "string" ? value.profile_link.trim() : "";
    const platform = LINK_PLATFORMS.find(([pattern]) => pattern.test(label))?.[1];
    // Only a real profile URL counts: a bare word in the link field could be anything.
    if (!platform || !link || !HANDLES[platform].url.test(link)) continue;
    const handle = normalizePlatformHandle(platform, link);
    if (handle && !out.has(platform)) out.set(platform, { platform, handle });
  }
  return [...out.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

const DAY = 86_400_000;

/**
 * Activity window relative to the fetch: active weeks in the trailing 52 weeks and activity in the
 * last 30 days. No timestamp is stored, so an unchanged profile keeps its fragment hash within a week.
 */
export function activityWindow(events: { at: number; count?: number }[], now: Date): { consistency: { activeWeeks: number; windowWeeks: number }; recentActivity: { last30Days: number } } {
  const weeks = new Set<number>(); let last30Days = 0;
  for (const event of events) {
    const age = (now.getTime() - event.at) / DAY, amount = event.count ?? 1;
    if (!Number.isFinite(age) || age < 0 || amount <= 0) continue;
    if (age <= 364) weeks.add(Math.floor(age / 7));
    if (age <= 30) last30Days += amount;
  }
  return { consistency: { activeWeeks: weeks.size, windowWeeks: 52 }, recentActivity: { last30Days } };
}

export const USER_AGENT = "interviewiq-backend (+profile builder; public profile data only)";

/** GET with a short timeout; 404 becomes NOT_FOUND, every other failure UNREACHABLE. */
export async function getText(fetchImpl: FetchLike, url: string, what: string, headers: Record<string, string> = {}): Promise<string> {
  try {
    return await requestText(fetchImpl, { method: "GET", url, headers: { "User-Agent": USER_AGENT, ...headers }, timeoutMs: 30_000 });
  } catch (err) {
    if (err instanceof UpstreamHttpError && err.status === 404) throw new PlatformProfileError("NOT_FOUND", `${what}: profile not found`, { cause: err });
    throw new PlatformProfileError("UNREACHABLE", `${what}: request failed`, { cause: err });
  }
}

export async function getJson(fetchImpl: FetchLike, url: string, what: string, headers: Record<string, string> = {}): Promise<unknown> {
  const text = await getText(fetchImpl, url, what, { Accept: "application/json", ...headers });
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new PlatformProfileError("UNREACHABLE", `${what}: response was not JSON`, { cause: err });
  }
}

/** Upsert the fragment only when its canonical hash changed (otherwise just bump fetchedAt). */
export async function storeFragment(fragments: ProfileFragmentRepository, userId: string, source: ProfileSource, data: Record<string, unknown>, now = new Date()): Promise<"inserted" | "unchanged" | "updated"> {
  const canonical = canonicalize(data), hash = sha256Hex(canonical), parsed = JSON.parse(canonical) as Record<string, unknown>;
  const existing = await fragments.findByUserIdAndSource(userId, source);
  if (!existing) {
    await fragments.insert({ userId, source, data: parsed, contentHash: hash, version: 1, fetchedAt: now });
    return "inserted";
  }
  if (existing.contentHash === hash) {
    await fragments.update(existing._id, { fetchedAt: now });
    return "unchanged";
  }
  await fragments.update(existing._id, { data: parsed, contentHash: hash, version: existing.version + 1, fetchedAt: now });
  return "updated";
}
