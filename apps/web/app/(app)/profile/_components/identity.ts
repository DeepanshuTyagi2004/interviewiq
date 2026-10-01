import type { EducationDto } from "@/features/onboarding";

/**
 * The identity card's one-line subtitle from the most recent education entry, in the design's
 * "B.Tech CSE · RVCE · 2027" shape. Returns null when there's nothing to show.
 */
export function educationLine(education: EducationDto[] | undefined): string | null {
  const edu = education?.[0];
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
