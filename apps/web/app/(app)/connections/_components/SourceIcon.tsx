import { GitBranch, FileText, Code2, Link2, Trophy, ListChecks, type LucideIcon } from "lucide-react";
import type { SourceKind } from "@/features/profile";

const ICONS: Record<SourceKind, LucideIcon> = {
  GITHUB: GitBranch,
  RESUME: FileText,
  LEETCODE: Code2,
  CODEFORCES: Trophy,
  CODECHEF: Trophy,
  ATCODER: Trophy,
  TUF: ListChecks,
  LINKEDIN: Link2,
};

export function SourceIcon({
  source,
  className,
}: {
  source: SourceKind;
  className?: string;
}) {
  const Icon = ICONS[source];
  return <Icon className={className} aria-hidden />;
}
