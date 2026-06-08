import { GitBranch, Code2, FileText, Link2, AtSign, type LucideIcon } from "lucide-react";
import { SectionLabel } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { NotableItem, SkillItem, SourceKind } from "@/features/profile";

/** Line-icon per source, shown on the right of each skill tag (matches the connections page). */
const SOURCE_ICON: Record<SourceKind, LucideIcon> = {
  GITHUB: GitBranch,
  LEETCODE: Code2,
  RESUME: FileText,
  LINKEDIN: Link2,
  X: AtSign,
};

function SkillTag({ skill }: { skill: SkillItem }) {
  const Icon = SOURCE_ICON[skill.source];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
      {skill.skill}
      <Icon className="h-3 w-3 text-muted-foreground" aria-label={`Source: ${skill.source}`} />
    </span>
  );
}

export interface AtAGlanceProps {
  atAGlance: string[];
  notable: NotableItem[];
  mostUsedSkills: SkillItem[];
}

export function AtAGlance({
  atAGlance,
  notable,
  mostUsedSkills,
}: AtAGlanceProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-3">
        <CardContent className="space-y-3 p-6">
          <SectionLabel>At a glance</SectionLabel>
          {atAGlance.length ? (
            <ul className="space-y-1.5 text-sm">
              {atAGlance.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Connect a source to see your highlights.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <SectionLabel>Notable</SectionLabel>
          {notable.length ? (
            <ul className="space-y-2 text-sm">
              {notable.map((n, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span>{n.text}</span>
                  <Badge
                    variant="secondary"
                    className="shrink-0 font-mono text-[10px]"
                  >
                    {n.source}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardContent className="space-y-3 p-6">
          <SectionLabel>Most-used skills</SectionLabel>
          {mostUsedSkills.length ? (
            <div className="flex flex-wrap gap-2">
              {mostUsedSkills.map((s, i) => (
                <SkillTag key={`${s.source}-${s.skill}-${i}`} skill={s} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No skills detected yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
