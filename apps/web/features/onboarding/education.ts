/**
 * Which education entry headlines a profile: the one that ends latest (so a degree beats school),
 * falling back to the first entry when no years are given. Works on API rows (null fields) and form
 * rows ("" fields) alike. Undated entries never beat dated ones.
 */
interface Dated {
  startYear: string | null;
  endYear: string | null;
}

/** The last 4-digit year in a free-text year field ("2025", "Expected 2027", "2021-25" → 2021). */
function yearOf(value: string | null): number | null {
  const years = value?.match(/\b(19|20)\d{2}\b/g);
  return years ? Number(years[years.length - 1]) : null;
}

export function primaryEducation<T extends Dated>(education: readonly T[] | undefined): T | null {
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

/** "B.Tech CSE · RVCE · 2027" from the primary entry, or null when there's nothing to show. */
export function educationLine(
  education: readonly (Dated & { degree: string | null; field: string | null; institution: string | null })[] | undefined,
): string | null {
  const edu = primaryEducation(education);
  if (!edu) return null;
  const course = [edu.degree, edu.field].filter(Boolean).join(" ");
  const parts = [course, edu.institution, edu.endYear].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
