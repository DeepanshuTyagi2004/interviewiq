import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { NotableItem, SkillItem } from "@/features/profile";

export interface AtAGlanceProps {
  atAGlance: string[];
  notable: NotableItem[];
  mostUsedSkills: SkillItem[];
}

export function AtAGlance({ atAGlance, notable, mostUsedSkills }: AtAGlanceProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">At a glance</CardTitle>
        </CardHeader>
        <CardContent>
          {atAGlance.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {atAGlance.map((item, i) => (
                <li key={i}>{item}</li>
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
        <CardHeader>
          <CardTitle className="text-base">Notable</CardTitle>
        </CardHeader>
        <CardContent>
          {notable.length ? (
            <ul className="space-y-2 text-sm">
              {notable.map((n, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span>{n.text}</span>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
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
        <CardHeader>
          <CardTitle className="text-base">Most-used skills</CardTitle>
        </CardHeader>
        <CardContent>
          {mostUsedSkills.length ? (
            <ul className="space-y-2 text-sm">
              {mostUsedSkills.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="font-medium">{s.skill}</span>
                  <span className="text-xs text-muted-foreground">{s.evidence}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No skills detected yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
