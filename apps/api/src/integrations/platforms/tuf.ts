import type { FetchLike } from "../../lib/http.js";
import { asInt, asString, isObject, items, path } from "../../lib/json.js";
import { activityWindow, getJson, getText, linkedProfilesFrom, PlatformProfileError, type LinkedProfile, type PlatformCollector, type PlatformSnapshot } from "./common.js";

/**
 * takeUforward: the public profile page's Next.js flight payload (DSA progress + heatmap) and the
 * public profile API, whose `coding_profiles` lists the user's other platforms (analyzer spec:
 * docs/sources/platform-analyzers.md). Names, colleges and images are never stored.
 */
export class TufCollector implements PlatformCollector {
  readonly platform = "TUF" as const;
  constructor(private readonly siteUrl: string, private readonly apiUrl: string, private readonly fetchImpl: FetchLike) {}

  async validate(handle: string): Promise<void> {
    await this.profile(handle);
  }

  async collect(handle: string, now: Date): Promise<PlatformSnapshot> {
    const profile = await this.profile(handle);
    const html = await getText(this.fetchImpl, `${this.siteUrl}/profile/${encodeURIComponent(handle)}`, "TUF profile page", { Accept: "text/html" });
    const linkedProfiles = linkedProfilesFrom(path(profile, "data", "coding_profiles"));
    return { data: toTufFragment(handle, html, linkedProfiles, now), linkedProfiles };
  }

  /** The API refuses requests without an Origin header. */
  private async profile(handle: string): Promise<unknown> {
    const root = await getJson(this.fetchImpl, `${this.apiUrl}/api/v1/shared/profile/get-profile/${encodeURIComponent(handle)}`, "TUF profile API",
      { Origin: this.siteUrl, Referer: `${this.siteUrl}/` });
    if (path(root, "success") !== true || !isObject(path(root, "data"))) throw new PlatformProfileError("NOT_FOUND", "TUF profile not found");
    return root;
  }
}

/** Concatenated, unescaped `self.__next_f.push([1, "..."])` chunks of a Next.js page. */
export function flightPayload(html: string): string {
  let out = "";
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(match[1]!) as string; } catch { /* a malformed chunk is skipped */ }
  }
  return out;
}

/** The JSON object value of the first `"key":{...}` in the payload (balanced-brace scan). */
export function payloadObject(payload: string, key: string): Record<string, unknown> | null {
  const start = payload.indexOf(`"${key}":{`);
  if (start < 0) return null;
  const open = start + key.length + 3;
  let depth = 0, inString = false;
  for (let i = open; i < payload.length; i++) {
    const ch = payload[i];
    if (inString) { if (ch === "\\") i++; else if (ch === "\"") inString = false; continue; }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { const value = JSON.parse(payload.slice(open, i + 1)) as unknown; return isObject(value) ? value : null; } catch { return null; }
    }
  }
  return null;
}

const TIERS: Record<string, "easy" | "medium" | "hard"> = { basic: "easy", core: "medium", pro: "hard" };

/** Pure: Basic/Core/Pro -> easy/medium/hard, per-topic solves, heatmap activity window, linked handles. */
export function toTufFragment(handle: string, html: string, linkedProfiles: LinkedProfile[], now: Date): Record<string, unknown> {
  const payload = flightPayload(html);
  const progress = payloadObject(payload, "dsaProgress"), heatmap = payloadObject(payload, "initialHeatmap");
  const tuf = path(progress, "byPlatform", "TUF");
  if (!isObject(tuf)) throw new PlatformProfileError("UNREACHABLE", "TUF profile page did not include DSA progress");
  const solved = { easy: 0, medium: 0, hard: 0 };
  for (const category of items(tuf.categories)) {
    const tier = TIERS[asString(path(category, "label"), "").trim().toLowerCase()];
    if (tier) solved[tier] = asInt(path(category, "solved"), 0);
  }
  const byTopic = items(tuf.topics).map((topic) => ({ topic: asString(path(topic, "label"), "").trim().toLowerCase().slice(0, 60), count: asInt(path(topic, "solved"), 0) }))
    .filter((topic) => topic.topic && topic.count > 0).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  const days = items(path(heatmap, "heatmapData")).flatMap((day) => {
    const date = asString(path(day, "date"), ""), count = asInt(path(day, "count"), 0);
    const at = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    return Number.isFinite(at) && count > 0 ? [{ at, count }] : [];
  });
  return {
    platform: "tuf", handle, solved, totalSolved: asInt(tuf.solved, 0), byTopic,
    ...(heatmap ? activityWindow(days, now) : {}),
    linkedProfiles,
  };
}
