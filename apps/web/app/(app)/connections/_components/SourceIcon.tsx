import { GitBranch, FileText, Code2, Link2, AtSign, type LucideIcon } from "lucide-react";
import type { SourceKind } from "@/features/profile";

const ICONS: Record<SourceKind, LucideIcon> = {
  GITHUB: GitBranch,
  RESUME: FileText,
  LEETCODE: Code2,
  LINKEDIN: Link2,
  X: AtSign,
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
