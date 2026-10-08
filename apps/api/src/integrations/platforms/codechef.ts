import type { FetchLike } from "../../lib/http.js";
import { getText, PlatformProfileError, type PlatformCollector, type PlatformSnapshot } from "./common.js";

/**
 * CodeChef has no public API: the public profile page is parsed (analyzer spec:
 * docs/sources/platform-analyzers.md). The parser fails closed when the markup changes.
 */
export class CodeChefCollector implements PlatformCollector {
  readonly platform = "CODECHEF" as const;
  constructor(private readonly baseUrl: string, private readonly fetchImpl: FetchLike) {}

  async validate(handle: string): Promise<void> {
    parseCodeChefProfile(handle, await this.page(handle));
  }

  async collect(handle: string): Promise<PlatformSnapshot> {
    return { data: parseCodeChefProfile(handle, await this.page(handle)), linkedProfiles: [] };
  }

  private page(handle: string): Promise<string> {
    return getText(this.fetchImpl, `${this.baseUrl}/users/${encodeURIComponent(handle)}`, "CodeChef profile", { Accept: "text/html" });
  }
}

const int = (text: string | undefined) => { const n = text === undefined ? NaN : Number.parseInt(text.replace(/,/g, ""), 10); return Number.isFinite(n) ? n : null; };

/** "2010-01-15 15:00:00" is CodeChef's local time (IST). */
function codeChefDate(value: unknown): string | null {
  const match = typeof value === "string" ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(value.trim()) : null;
  if (!match) return null;
  const at = new Date(`${match[1]}T${match[2]}+05:30`);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

/** Pure: rating block, stars, global rank, solved/contest counts and the embedded contest history. */
export function parseCodeChefProfile(handle: string, html: string): Record<string, unknown> {
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  // An unknown handle redirects to a generic page without the profile title.
  if (!/CodeChef User Profile/i.test(title)) throw new PlatformProfileError("NOT_FOUND", "CodeChef handle not found");
  const rating = int(/class="rating-number">\s*(\d+)/.exec(html)?.[1]);
  const highestRating = int(/Highest Rating\s+(\d+)/.exec(html)?.[1]);
  const stars = int(/(\d)&#9733;/.exec(html)?.[1]);
  const globalRank = int(/class='global-rank'>(\d[\d,]*)</.exec(html)?.[1]);
  const fullySolved = int(/Total Problems Solved:\s*(\d+)/.exec(html)?.[1]);
  const contestsAttended = int(/No\. of Contests Participated:\s*<b>\s*(\d+)/.exec(html)?.[1]);
  let ratingHistory: { at: string; rating: number; rank: number | null }[] = [];
  const raw = /var all_rating = (\[[\s\S]*?\]);/.exec(html)?.[1];
  if (raw) {
    try {
      ratingHistory = (JSON.parse(raw) as unknown[]).flatMap((row) => {
        const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
        const at = codeChefDate(value.end_date), r = int(String(value.rating ?? "")), rank = int(String(value.rank ?? ""));
        return at && r !== null && r > 0 ? [{ at, rating: r, rank }] : [];
      }).sort((a, b) => a.at.localeCompare(b.at)).slice(-200);
    } catch {
      ratingHistory = [];
    }
  }
  if (rating === null && fullySolved === null && !ratingHistory.length) throw new PlatformProfileError("UNREACHABLE", "CodeChef profile markup was not recognized");
  return {
    platform: "codechef", handle,
    rating, highestRating, stars, globalRank, fullySolved,
    contestsAttended: contestsAttended ?? (ratingHistory.length || null),
    ratingHistory,
  };
}
