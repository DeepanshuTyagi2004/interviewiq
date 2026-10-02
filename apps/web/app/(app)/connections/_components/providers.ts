import type { SourceKind } from "@/features/profile";

export interface ProviderMeta {
  source: SourceKind;
  label: string;
  /** Two-letter mono mark on the source's ink tile (the design's "GH", "LC", …). */
  code: string;
  description: string;
  /** GitHub, resume and LeetCode are live; the rest are "coming soon" placeholders. */
  live: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    source: "GITHUB",
    label: "GitHub",
    code: "GH",
    description: "Languages, repos, contributions and external PRs.",
    live: true,
  },
  {
    source: "RESUME",
    label: "Resume",
    code: "CV",
    description: "Work history, education, projects and achievements.",
    live: true,
  },
  {
    source: "LEETCODE",
    label: "LeetCode",
    code: "LC",
    description: "Solved problems by difficulty and topic.",
    live: true,
  },
  {
    source: "LINKEDIN",
    label: "LinkedIn",
    code: "IN",
    description: "Professional profile (coming later).",
    live: false,
  },
  {
    source: "X",
    label: "X",
    code: "X",
    description: "Public handle for link-out (coming later).",
    live: false,
  },
];
