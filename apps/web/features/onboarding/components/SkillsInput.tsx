"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";

/** Comma-separated string ⇄ a clean, de-duplicated list (order kept, first spelling wins). */
export function parseSkills(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const skill = raw.trim();
    const key = skill.toLowerCase();
    if (skill && !seen.has(key)) {
      seen.add(key);
      out.push(skill);
    }
  }
  return out;
}

export interface SkillsInputProps {
  /** Comma-separated skills (the form's `skillsText`). */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  id?: string;
}

/**
 * The design's skill chips: click a chip to remove it, type and press Enter (or a comma) to add.
 * Backspace in the empty field removes the last chip. Stores the same comma-separated string the
 * API mapping expects.
 */
export function SkillsInput({ value, onChange, onBlur, id }: SkillsInputProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const [draft, setDraft] = useState("");
  const skills = parseSkills(value);

  const commit = (list: string[]) => onChange(list.join(", "));

  function add(raw: string) {
    const next = parseSkills([...skills, ...raw.split(",")].join(","));
    if (next.length !== skills.length) commit(next);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && skills.length > 0) {
      commit(skills.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <button
          key={skill}
          type="button"
          onClick={() => commit(skills.filter((s) => s !== skill))}
          aria-label={`Remove ${skill}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-line-3 bg-card px-3 py-1.5 text-[13px] text-foreground transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {skill}
          <X aria-hidden className="h-3 w-3 text-faint" />
        </button>
      ))}
      <input
        id={inputId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) add(draft);
          onBlur?.();
        }}
        placeholder="+ Add skill"
        aria-label="Add a skill"
        className="h-8 w-32 rounded-full border border-dashed border-line-4 bg-card px-2.5 text-[13px] text-foreground outline-none placeholder:text-placeholder focus:border-faint"
      />
    </div>
  );
}
