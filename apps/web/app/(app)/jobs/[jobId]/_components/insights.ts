/** Pure helpers for the roadmap's Insights tab. Counts come only from the brief's source list. */

const KNOWN_SITES: Record<string, string> = {
  "reddit.com": "Reddit",
  "leetcode.com": "LeetCode",
  "glassdoor.com": "Glassdoor",
  "glassdoor.co.in": "Glassdoor",
  "youtube.com": "YouTube",
  "medium.com": "Medium",
  "geeksforgeeks.org": "GeeksforGeeks",
  "linkedin.com": "LinkedIn",
  "ambitionbox.com": "AmbitionBox",
  "interviewbit.com": "InterviewBit",
};

export type SourceGroup = { site: string; host: string; urls: string[] };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^(www|m|old)\./, "");
  } catch {
    return null;
  }
}

/**
 * Group the brief's source URLs by site, most-cited first. The count per site is the real number
 * of source URLs, the stand-in for the design's per-source experience counts.
 */
export function groupSources(urls: string[]): SourceGroup[] {
  const map = new Map<string, string[]>();
  for (const raw of urls) {
    const url = raw.trim();
    if (!url) continue;
    const host = hostOf(url) ?? url;
    map.set(host, [...new Set([...(map.get(host) ?? []), url])]);
  }
  return [...map.entries()]
    .map(([host, list]) => ({ site: KNOWN_SITES[host] ?? host, host, urls: list }))
    .sort((a, b) => b.urls.length - a.urls.length || a.site.localeCompare(b.site));
}

/** "high" → "high"; unknown/absent → null. Only the three confidence levels the brief emits. */
export function confidenceWord(confidence: string | null | undefined): "high" | "medium" | "low" | null {
  const c = confidence?.trim().toLowerCase();
  return c === "high" || c === "medium" || c === "low" ? c : null;
}
