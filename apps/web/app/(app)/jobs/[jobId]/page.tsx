"use client";

import { useParams } from "next/navigation";
import { toast } from "sonner";
import { PageHeader, Section, SectionLabel, EmptyState } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useJd, type ConsolidatedRound } from "@/features/jobs";

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data: jd, isLoading, isError } = useJd(jobId);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (isError || !jd) {
    return (
      <div className="flex-1 p-6">
        <p role="alert" className="text-sm text-destructive">
          Could not load this job description.
        </p>
      </div>
    );
  }

  const process = jd.interviewProcess;

  return (
    <div className="flex-1 space-y-8 p-6">
      <PageHeader
        title={jd.title}
        description={`${jd.companyName} · ${jd.level}${jd.specialization ? ` · ${jd.specialization}` : ""}`}
        actions={
          <Button
            onClick={() => toast.info("Scheduling a mock interview is coming soon.")}
            title="Interview scheduling is coming soon"
          >
            Practice this interview
          </Button>
        }
      />

      {jd.techStack.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {jd.techStack.map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
      ) : null}

      {jd.description ? (
        <Section title="About the role">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{jd.description}</p>
          {jd.sourceUrl ? (
            <a
              href={jd.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block break-all font-mono text-xs text-primary underline-offset-4 hover:underline"
            >
              Original posting ↗
            </a>
          ) : null}
        </Section>
      ) : null}

      <Section title="Interview process">
        {process && (process.rounds?.length ?? 0) > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {process.typical_round_count ? <span>Typically {process.typical_round_count} rounds.</span> : null}
              <Badge variant={confidenceVariant(process.data_confidence)}>
                {confidenceLabel(jd.dataAvailability)}
              </Badge>
            </div>

            <div className="space-y-2">
              {process.rounds!.map((r, i) => (
                <RoundCard key={i} round={r} />
              ))}
            </div>

            {process.difficulty_calibration ? (
              <Field label="Difficulty">{process.difficulty_calibration}</Field>
            ) : null}
            {process.interviewer_style_notes ? (
              <Field label="Interviewer style">{process.interviewer_style_notes}</Field>
            ) : null}
            {process.red_flags && process.red_flags.length > 0 ? (
              <Field label="Common mistakes / red flags">
                <ul className="list-disc space-y-1 pl-5">
                  {process.red_flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </Field>
            ) : null}
            {process.company_specific_patterns ? (
              <Field label="Company-specific patterns">{process.company_specific_patterns}</Field>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title="Interview data not available yet"
            hint="A brief for this role hasn't been generated, or the data was too sparse. Try refreshing it from the Intelligence console."
          />
        )}
      </Section>

      {jd.sources.length > 0 ? (
        <Section title="Sources">
          <ul className="space-y-1">
            {jd.sources.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-xs text-primary underline-offset-4 hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function RoundCard({ round }: { round: ConsolidatedRound }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">
          Round {round.round_number ?? "?"}
          {round.type ? ` · ${round.type}` : ""}
        </span>
        {round.difficulty ? <Badge variant="secondary">{round.difficulty}</Badge> : null}
        {round.consistency ? (
          <span className="text-xs text-muted-foreground">({round.consistency})</span>
        ) : null}
      </div>
      {round.format ? (
        <p className="mt-2 text-sm text-muted-foreground">{round.format}</p>
      ) : null}
      {round.dominant_topics && round.dominant_topics.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {round.dominant_topics.map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>{label}</SectionLabel>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function confidenceVariant(c?: string | null): "default" | "secondary" | "outline" {
  if (c === "high") return "default";
  if (c === "medium") return "secondary";
  return "outline";
}

function confidenceLabel(a: string): string {
  switch (a) {
    case "rich":
      return "Rich interview data";
    case "available":
      return "Data available";
    case "limited":
      return "Limited data";
    default:
      return "No data yet";
  }
}
