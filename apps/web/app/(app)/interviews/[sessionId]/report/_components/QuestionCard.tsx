"use client";

import { Chip } from "@/components/ds";
import { formatScore, type ReportQuestion, type RoundReport } from "@/features/report";
import { BoardAnswer } from "./BoardAnswer";
import { CodeAnswer } from "./CodeAnswer";
import { DisputeControl } from "./DisputeDialog";
import { MomentLink } from "./MomentLink";

const VERDICT_LABEL: Record<ReportQuestion["verdict"], string> = {
  correct: "Correct",
  mostly: "Mostly correct",
  partly: "Partly correct",
  wrong: "Not correct",
  not_answered: "Not answered",
  not_reached: "Not reached",
};

const RESUME_LABEL: Record<string, string> = {
  consistent: "Resume: consistent",
  unsupported: "Resume: not supported",
  contradicts: "Resume: contradicts",
};

export function QuestionCard({ report, question, index, sessionId }: { report: RoundReport; question: ReportQuestion; index: number; sessionId: string }) {
  const problem = question.title?.trim();
  const asked = question.asked?.trim();
  const title = asked || problem || "";
  const scenario = question.origin === "candidate_led";
  const resume = question.resumeConsistency ? RESUME_LABEL[question.resumeConsistency] : undefined;
  const good = question.verdict === "correct" || question.verdict === "mostly";
  return (
    <li className="border-t border-line px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <h3 className="m-0 min-w-0 text-[15.5px] font-normal leading-snug">
          <span className="mr-2.5 font-mono text-[12px] text-ink-3">Q{index + 1}</span>
          {title}
          {asked && problem && problem !== asked ? <span className="ml-2.5 text-[12.5px] text-ink-3">{problem}</span> : null}
          {scenario ? <span className="ml-2.5 align-middle"><Chip tone="default">Scenario</Chip></span> : null}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={good ? "ink" : "outline"}>{VERDICT_LABEL[question.verdict] ?? question.verdict}</Chip>
          {question.score != null ? <span className="font-mono text-[13px] tabular-nums">{formatScore(question.score)}</span> : null}
          {resume ? (
            <span title={question.resumeNote ?? undefined}>
              <Chip tone="default">{resume}</Chip>
            </span>
          ) : null}
        </div>
      </div>

      {scenario && question.intent ? <p className="m-0 mt-2 max-w-[68ch] text-[13.5px] leading-[1.6] text-ink-2">{question.intent}</p> : null}

      {question.answerQuotes.length > 0 ? (
        <div className="mt-3">
          <p className="m-0 text-[12.5px] text-ink-3">You said</p>
          <ul className="m-0 mt-1.5 list-none space-y-2 p-0">
            {question.answerQuotes.map((q, i) => (
              <li key={`${q.turnId}-${i}`} className="flex items-start gap-2.5 border-l-2 border-line pl-3 text-[13.5px] leading-[1.6]">
                <q className="min-w-0 text-ink-2">{q.text}</q>
                <MomentLink turnId={q.turnId} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {question.strongAnswer ? (
        <p className="m-0 mt-4 max-w-[68ch] text-[13.5px] leading-[1.6]">
          <span className="text-ink-3">A strong answer: </span>
          {question.strongAnswer}
        </p>
      ) : null}
      {question.gap ? (
        <p className="m-0 mt-2 max-w-[68ch] text-[13.5px] leading-[1.6]">
          <span className="text-ink-3">What was missing: </span>
          {question.gap}
        </p>
      ) : null}

      {question.topics.length > 0 ? (
        <ul className="m-0 mt-4 flex list-none flex-wrap items-center gap-1.5 p-0">
          <li className="mr-1 text-[12.5px] text-ink-3">Topics</li>
          {question.topics.map((t, i) => (
            <li key={`${t.subject}-${t.topic}-${i}`}>
              <Chip>{t.topic}</Chip>
            </li>
          ))}
        </ul>
      ) : null}

      {question.code && question.code.text ? <CodeAnswer code={question.code} /> : null}
      {question.board ? <BoardAnswer board={question.board} /> : null}

      <div className="mt-4">
        <DisputeControl report={report} sessionId={sessionId} targetType="question" targetId={question.id} targetLabel={title} />
      </div>
    </li>
  );
}
