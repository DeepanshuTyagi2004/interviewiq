import { SectionLabel } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { NotableItem, SkillItem } from "@/features/profile";

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
            <ul className="space-y-2 text-sm">
              {mostUsedSkills.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="font-medium">{s.skill}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {s.evidence}
                  </span>
                </li>
              ))}
            </ul>
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
