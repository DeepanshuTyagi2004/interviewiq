import type { EducationDto } from "@/features/onboarding";

/** The last 4-digit year in a free-text year field ("2025", "Expected 2027", "2021-25" → 2021). */
function yearOf(value: string | null): number | null {
  const years = value?.match(/\b(19|20)\d{2}\b/g);
  return years ? Number(years[years.length - 1]) : null;
}

/**
 * The education entry to headline the profile with: the one that ends latest (so a degree beats
 * school), falling back to the first entry when no years are given. Undated entries never beat dated
 * ones.
 */
export function primaryEducation(education: EducationDto[] | undefined): EducationDto | null {
  if (!education?.length) return null;
  let best = education[0];
  let bestYear = yearOf(best.endYear) ?? yearOf(best.startYear);
  for (const edu of education.slice(1)) {
    const year = yearOf(edu.endYear) ?? yearOf(edu.startYear);
    if (year !== null && (bestYear === null || year > bestYear)) {
      best = edu;
      bestYear = year;
    }
  }
  return best;
}

/**
 * The identity card's one-line subtitle from the primary education entry, in the design's
 * "B.Tech CSE · RVCE · 2027" shape. Returns null when there's nothing to show.
 */
export function educationLine(education: EducationDto[] | undefined): string | null {
  const edu = primaryEducation(education);
  if (!edu) return null;
  const course = [edu.degree, edu.field].filter(Boolean).join(" ");
  const parts = [course, edu.institution, edu.endYear].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "2023–2027", "2027", or null. */
export function yearRange(start: string | null, end: string | null): string | null {
  const parts = [start, end].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join("–") : null;
}

/**
 * A user-typed project link as a safe href: http(s) URLs as-is, bare domains ("github.com/a/b")
 * get https://, anything else (javascript:, mailto:, junk) → null so it renders as plain text.
 */
export function externalHref(link: string | null): string | null {
  const raw = link?.trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw) ? `https://${raw}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** A link as shown on screen: no protocol, no trailing slash ("github.com/asha/ledger"). */
export function displayLink(href: string): string {
  return href.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
