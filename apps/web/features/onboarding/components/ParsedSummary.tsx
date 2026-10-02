"use client";

import { useWatch, type Control } from "react-hook-form";
import type { CandidateFormValues } from "../form";
import { parseSkills } from "./SkillsInput";

function joinParts(parts: (string | undefined)[]): string {
  return parts.map((p) => p?.trim()).filter(Boolean).join(" · ");
}

/** What the resume parse found, as the design's key/value table with a FOUND tag per row. */
export function ParsedSummary({ control }: { control: Control<CandidateFormValues> }) {
  const [fullName, education, experience, projects, skillsText] = useWatch({
    control,
    name: ["fullName", "education", "experience", "projects", "skillsText"],
  });

  const edu = education[0];
  const exp = experience[0];
  const rows = [
    { k: "Name", v: fullName },
    { k: "Education", v: edu ? joinParts([edu.degree, edu.field, edu.institution, edu.endYear]) : "" },
    { k: "Experience", v: exp ? joinParts([exp.title, exp.company]) : "" },
    { k: "Projects", v: projects.map((p) => p.name).filter(Boolean).slice(0, 3).join(", ") },
    { k: "Skills", v: parseSkills(skillsText).slice(0, 5).join(", ") },
  ];

  return (
    <dl className="m-0 overflow-hidden rounded-lg border border-line-2">
      {rows.map((row) => (
        <div
          key={row.k}
          className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-3 text-[13.5px] last:border-b-0 sm:grid-cols-[140px_minmax(0,1fr)_auto]"
        >
          <dt className="text-faint">{row.k}</dt>
          <dd className="m-0 truncate">{row.v || <span className="text-faint">Not found</span>}</dd>
          <span className="font-mono text-[10px] text-faint">{row.v ? "FOUND" : "—"}</span>
        </div>
      ))}
    </dl>
  );
}
