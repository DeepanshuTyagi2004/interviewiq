"use client";

import { Card, EmptyState } from "@/components/ds";
import type { RoundReport } from "@/features/report";
import { QuestionCard } from "./QuestionCard";

export function QuestionsSection({ report, sessionId }: { report: RoundReport; sessionId: string }) {
  const questions = report.questions ?? [];
  return (
    <Card flush title="Scenarios and questions" meta={questions.length ? `${questions.length} in total` : undefined} headerClassName="pb-4">
      {questions.length === 0 ? (
        <EmptyState orb={false} title="No questions to show" className="border-t border-line py-10" />
      ) : (
        <ol className="m-0 list-none p-0">
          {questions.map((q, i) => (
            <QuestionCard key={q.id} report={report} question={q} index={i} sessionId={sessionId} />
          ))}
        </ol>
      )}
    </Card>
  );
}
