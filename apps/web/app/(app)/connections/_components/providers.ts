import type { SourceKind } from "@/features/profile";

export interface ProviderMeta {
  source: SourceKind;
  label: string;
  /** Two-letter mono mark on the source's ink tile (the design's "GH", "LC", …). */
  code: string;
  description: string;
  /** Available sources, including consented imports; this does not imply live synchronization. */
  live: boolean;
}

// Resume first (enough on its own), then LeetCode: our first users have strong LeetCode and thin GitHub.
export const PROVIDERS: ProviderMeta[] = [
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
    source: "GITHUB",
    label: "GitHub",
    code: "GH",
    description: "Languages, repos, contributions and external PRs.",
    live: true,
  },
  {
    source: "TUF",
    label: "takeUforward",
    code: "TF",
    description: "Sheet progress by Basic/Core/Pro and topic. Platforms you linked on TUF connect too.",
    live: true,
  },
  {
    source: "CODEFORCES",
    label: "Codeforces",
    code: "CF",
    description: "Contest rating history and solved problems by difficulty and tag.",
    live: true,
  },
  {
    source: "CODECHEF",
    label: "CodeChef",
    code: "CC",
    description: "Rating, stars, contests and problems solved.",
    live: true,
  },
  {
    source: "ATCODER",
    label: "AtCoder",
    code: "AC",
    description: "Rated contest history and accepted problems.",
    live: true,
  },
  {
    source: "LINKEDIN",
    label: "LinkedIn",
    code: "IN",
    description: "Upload the PDF LinkedIn makes of your profile. Import shows you how.",
    live: true,
  },
];
