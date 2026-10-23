import type { EngineeringLevel } from "@/lib/constants/engineering-levels";
import type { CandidateFormValues } from "./form";

type Experience = Pick<CandidateFormValues["experience"][number], "title" | "startDate" | "endDate">;
type Education = Pick<CandidateFormValues["education"][number], "endYear">;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PRESENT = /^(?:present|current(?:ly)?|now|ongoing|till (?:date|now|present)|to (?:date|present))$/i;

/** Month index (year * 12 + month) from "2023", "2023-05", "Sept. 2023", "May 2023"; null when unreadable. */
function monthIndex(value: string): number | null {
  const text = value.trim();
  const iso = /^(\d{4})(?:-(\d{1,2}))?/.exec(text);
  if (iso) return Number(iso[1]) * 12 + (iso[2] ? Number(iso[2]) : 1) - 1;
  const named = /^([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i.exec(text);
  const month = named ? MONTHS.indexOf(named[1]!.toLowerCase()) : -1;
  return named && month >= 0 ? Number(named[2]) * 12 + month : null;
}

/**
 * A starting point for the level dropdown, read from a parsed resume. Only a preselection — the
 * candidate's own choice always wins, and the target role is never consulted. Returns null when
 * the resume says too little to guess.
 */
export function guessLevelFromResume(
  experience: Experience[],
  education: Education[],
  now: Date = new Date(),
): EngineeringLevel | null {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();

  const ranges: [number, number][] = [];
  let internships = 0;
  for (const entry of experience) {
    const start = monthIndex(entry.startDate);
    const end = PRESENT.test(entry.endDate.trim()) ? current : monthIndex(entry.endDate);
    if (start === null || end === null || start > end || start > current) continue;
    if (/\bintern(?:ship)?\b|\btrainee\b/i.test(entry.title)) { internships += 1; continue; }
    ranges.push([start, Math.min(end, current)]);
  }

  // Overlapping jobs count once.
  ranges.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let open: [number, number] | null = null;
  for (const range of ranges) {
    if (open && range[0] <= open[1] + 1) open[1] = Math.max(open[1], range[1]);
    else { if (open) months += open[1] - open[0] + 1; open = [...range]; }
  }
  if (open) months += open[1] - open[0] + 1;
  const years = months / 12;

  if (years >= 8) return "staff";
  if (years >= 5) return "sde3";
  if (years >= 2) return "sde2";
  if (years >= 0.5) return "sde1";

  // No real work history: decide from where they are in their degree.
  const gradYears = education.map((e) => Number(e.endYear)).filter((y) => Number.isInteger(y) && y > 1970);
  const stillStudying = gradYears.length > 0 && Math.max(...gradYears) * 12 + 11 >= current;
  if (stillStudying && internships > 0) return "intern";
  if (stillStudying || internships > 0 || months > 0 || gradYears.length > 0) return "fresher";
  return null;
}
