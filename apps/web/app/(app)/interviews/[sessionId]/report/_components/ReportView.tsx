"use client";

import Link from "next/link";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { Button } from "@/components/ui/button";
import { PageHeader, Card } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { ROUTES } from "@/lib/constants/shared";
import { useSession, type InterviewSession } from "@/features/interview";
import { bookingHref, roundLabel } from "@/features/interview/presentation";
import { shortLevel, useReport, type RoundReport } from "@/features/report";
import { OverviewCard } from "./OverviewCard";
import { ReportEvaluating } from "./ReportEvaluating";
import { ReportUnscorable } from "./ReportUnscorable";
import { QuestionsSection } from "./QuestionsSection";
import { WorkOnSection } from "./WorkOnSection";
import { DeliverySection } from "./DeliverySection";
import { ConductSection } from "./ConductSection";
import { TranscriptSection } from "./TranscriptSection";
import { ScoreBuildUp } from "./ScoreBuildUp";
import { ScoreRail, shortDate, type RailCta, type RailNavItem } from "./ScoreRail";

export { jumpToTurn } from "./jumpToTurn";

function titleCase(s: string): string {
  return s.split(/[\s_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function Header({ report, session }: { report: RoundReport; session: InterviewSession | undefined }) {
  const m = report.meta;
  const company = m?.company ?? session?.companyName ?? session?.company ?? null;
  const round = m?.round ? roundLabel(m.round) : session ? roundLabel(session.roundType) : null;
  const parts = [
    "Debrief",
    company ? titleCase(company) : null,
    m?.level ? shortLevel(m.level) : null,
    round,
  ].filter(Boolean);
  const eyebrow = parts.join(" · ");
  return (
    <PageHeader
      eyebrow={<span title={eyebrow}>{eyebrow}</span>}
      title={round ?? "Round report"}
      actions={
        <Button asChild variant="outline">
          <Link href={ROUTES.interviews}>All interviews</Link>
        </Button>
      }
    />
  );
}

function retakeHref(session: InterviewSession | undefined): string {
  if (!session) return ROUTES.interviews;
  if (session.loopId && !session.jobDescriptionId) return `${ROUTES.loops}/${session.loopId}`;
  return bookingHref({ jd: session.jobDescriptionId ?? undefined, round: session.roundType });
}

function railCta(report: RoundReport, session: InterviewSession | undefined): RailCta | null {
  const outcome = report.outcome;
  if (outcome === "passed") {
    if (!report.nextRound) return null;
    const cur = report.meta?.round?.match(/^\s*(?:round\s*)?(\d+)\b/i);
    const label = cur ? `Book round ${Number(cur[1]) + 1}` : `Book ${report.nextRound.name}`;
    const href = session?.loopId ? `${ROUTES.loops}/${session.loopId}` : ROUTES.loops;
    return { href, label };
  }
  if (outcome === "below_pass" || outcome === "auto_fail") {
    const after = report.retakeAfter ? new Date(report.retakeAfter) : null;
    if (!after) return { href: retakeHref(session), label: "Retake now" };
    const ready = after.getTime() <= Date.now();
    return { href: ready ? retakeHref(session) : null, label: ready ? "Retake now" : `Retake from ${shortDate(report.retakeAfter as string)}` };
  }
  if (outcome === "unscorable") return { href: retakeHref(session), label: "Retake now" };
  return null;
}

function Ready({ report, session, sessionId }: { report: RoundReport; session: InterviewSession | undefined; sessionId: string }) {
  const { interviewBlocked } = useCurrentUser();
  // Booking the next round or retaking is an interview action: without access show the note instead.
  const cta = railCta(report, session);
  const nav: RailNavItem[] = [
    { id: "overview", label: "Overview" },
    { id: "score", label: "Score build-up" },
    { id: "questions", label: "Scenarios and questions", count: report.questions?.length },
    { id: "work-on", label: "Work on", count: report.focus?.length },
    { id: "delivery", label: "Delivery" },
    { id: "conduct", label: "Conduct & integrity" },
    { id: "transcript", label: "Transcript" },
  ];
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
      {cta && interviewBlocked ? <InterviewAccessNote className="lg:col-span-2" /> : null}
      <ScoreRail report={report} cta={interviewBlocked ? null : cta} nav={nav} />
      <div className="flex min-w-0 flex-col gap-10">
        <section id="overview" className="scroll-mt-20">
          <OverviewCard report={report} />
        </section>
        <section id="score" className="scroll-mt-20">
          <ScoreBuildUp report={report} sessionId={sessionId} />
        </section>
        <section id="questions" className="scroll-mt-20">
          <QuestionsSection report={report} sessionId={sessionId} />
        </section>
        <section id="work-on" className="scroll-mt-20">
          <WorkOnSection report={report} />
        </section>
        <section id="delivery" className="scroll-mt-20">
          <DeliverySection report={report} />
        </section>
        <section id="conduct" className="scroll-mt-20">
          <ConductSection report={report} />
        </section>
        <section id="transcript" className="scroll-mt-20">
          <TranscriptSection report={report} />
        </section>
      </div>
    </div>
  );
}

/** The candidate's debrief for a session: evaluating / failed / legacy / unscorable / ready. */
export function ReportView({ sessionId }: { sessionId: string }) {
  const { data: report, isLoading, error } = useReport(sessionId);
  const { data: session } = useSession(sessionId);

  if (isLoading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-10">
        <p className="sr-only">Loading your report…</p>
        <div>
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-4 h-10 w-80 max-w-full" />
        </div>
        <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Skeleton className="h-80 rounded-card" />
          <Skeleton className="h-80 rounded-card" />
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="rounded-tile bg-surface">
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p role="alert" className="m-0 font-display text-[20px] font-normal tracking-[-0.02em]">
            Failed to load your report. Refresh the page to try again.
          </p>
          <Button asChild variant="outline" className="mt-3">
            <Link href={ROUTES.interviews}>All interviews</Link>
          </Button>
        </div>
      </div>
    );
  }

  let body: React.ReactNode;
  if (report.status === "evaluating") {
    body = <ReportEvaluating />;
  } else if (report.status === "failed") {
    body = (
      <ReportUnscorable
        title="Your report is taking longer than usual"
        reason="We're still working on it — it will appear here automatically. If you don't want to wait, you can retake this round now; there's no cooldown."
        note={null}
        retakeVariant="secondary"
        retakeHref={retakeHref(session)}
        backHref={ROUTES.interviews}
        backLabel="All interviews"
      />
    );
  } else if (report.status === "legacy") {
    body = (
      <Card className="max-w-[560px]">
        <p className="m-0 text-[14.5px] leading-[1.55]">
          This round was taken before scoring was introduced — it counts as completed (not scored).
        </p>
        <Link href={ROUTES.interviews} className="mt-3 inline-block rounded-md text-[13.5px] text-ink underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2">
          Back to all interviews
        </Link>
      </Card>
    );
  } else if (report.outcome === "unscorable") {
    body = (
      <ReportUnscorable
        title="Not scored"
        reason={report.unscorableReason ?? "This round could not be scored."}
        retakeHref={retakeHref(session)}
        backHref={ROUTES.interviews}
        backLabel="All interviews"
      />
    );
  } else {
    body = <Ready report={report} session={session} sessionId={sessionId} />;
  }

  return (
    <div className="flex flex-col gap-10">
      <Header report={report} session={session} />
      {body}
    </div>
  );
}
