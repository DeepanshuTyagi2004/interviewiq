"use client";

import Link from "next/link";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, SectionLabel } from "@/components/patterns";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { useMySessions, useRegenerateSession, type InterviewSession } from "@/features/interview";
import { StatusPill } from "./StatusPill";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SessionCard({ session }: { session: InterviewSession }) {
  const regenerate = useRegenerateSession();
  const failed = session.status === "PREP_FAILED";
  const ready = session.status === "PREP_READY";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {session.companyName ?? session.company}
          </p>
          <h3 className="text-sm font-semibold tracking-tight">
            {ROUND_LABEL.get(session.roundType) ?? session.roundType}
            <span className="text-muted-foreground"> · {session.level}</span>
          </h3>
          <p className="font-mono text-xs text-muted-foreground">{formatSlot(session.scheduledAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={session.status} />
          {ready ? (
            <Button asChild size="sm">
              <Link href={`/interviews/${session.id}/live`}>Join</Link>
            </Button>
          ) : null}
          {failed ? (
            <Button
              size="sm"
              variant="outline"
              disabled={regenerate.isPending}
              onClick={() =>
                regenerate.mutate(session.id, {
                  onSuccess: () => toast.success("Retrying prep…"),
                  onError: () => toast.error("Couldn't retry prep. Please try again."),
                })
              }
            >
              <RotateCw className={regenerate.isPending ? "animate-spin" : ""} />
              Retry
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function SessionsList() {
  const { data, isLoading, isError } = useMySessions();

  return (
    <section className="space-y-3">
      <SectionLabel>Your interviews</SectionLabel>
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : isError || !data ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load your interviews.
        </p>
      ) : data.sessions.length === 0 ? (
        <EmptyState
          title="No interviews yet"
          hint="Book your first mock interview above — pick a role, a round, and a time."
        />
      ) : (
        <div className="space-y-3">
          {data.sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </section>
  );
}
