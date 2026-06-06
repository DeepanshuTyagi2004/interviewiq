import type { SourceKind } from "@/features/profile";

export interface ProviderMeta {
  source: SourceKind;
  label: string;
  description: string;
  /** Only GitHub is live this slice; the rest are "Connect" placeholders. */
  live: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    source: "GITHUB",
    label: "GitHub",
    description: "Languages, repos, contributions and external PRs.",
    live: true,
  },
  {
    source: "RESUME",
    label: "Résumé",
    description: "Work history, education, projects and achievements.",
    live: false,
  },
  {
    source: "LEETCODE",
    label: "LeetCode",
    description: "Solved problems by difficulty and topic.",
    live: false,
  },
  {
    source: "LINKEDIN",
    label: "LinkedIn",
    description: "Professional profile (coming later).",
    live: false,
  },
  {
    source: "X",
    label: "X",
    description: "Public handle for link-out (coming later).",
    live: false,
  },
];
