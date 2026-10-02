"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MonoPill } from "@/components/patterns";
import { Count } from "@/components/hud";
import { CardEmpty, ConsoleCard, HeaderCount, LookPill } from "@/components/observability/ConsoleCard";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { OUTLINE_PILL } from "@/components/observability/status";
import { useQuestions, type Question } from "@/features/intelligence";
import { cn } from "@/lib/utils/cn";
import { SELECT_CLASS } from "./fields";
import { DIFFICULTY_PILL } from "./pills";
import { ExtLink } from "./viewers";

const ROUND_OPTIONS = [
  { value: "", label: "All rounds" },
  { value: "dsa", label: "DSA" },
  { value: "system-design", label: "System Design" },
  { value: "lld", label: "LLD" },
  { value: "behavioural", label: "Behavioural / HR" },
];

const DIFFICULTY_OPTIONS = [
  { value: "", label: "All difficulties" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

function roundLabel(r: Question["round_type"]) {
  if (r === "dsa") return "DSA";
  if (r === "system-design") return "System Design";
  if (r === "lld") return "LLD";
  if (r === "behavioural") return "Behavioural / HR";
  return r;
}

export function QuestionBankPanel() {
  const [roundType, setRoundType] = useState("dsa");
  const [difficulty, setDifficulty] = useState("");
  const [company, setCompany] = useState("");

  const { data, isLoading, isError } = useQuestions({
    roundType: roundType || undefined,
    difficulty: difficulty || undefined,
    company: company || undefined,
    limit: 200,
  });

  // No count until the data is in: while loading or on error the header shows "—", never a made-up "00".
  const shown = data ? (data.returned ?? data.questions.length) : 0;
  const countLabel =
    !data || isError ? (
      "—"
    ) : shown < data.count ? (
      <>
        Showing <Count n={shown} /> of <Count n={data.count} /> ingested
      </>
    ) : (
      <>
        <Count n={data.count} /> questions ingested
      </>
    );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div role="group" aria-label="Filter questions" className="flex flex-wrap items-center gap-2">
        <select
          value={roundType}
          onChange={(e) => setRoundType(e.target.value)}
          className={cn(SELECT_CLASS, "w-auto min-w-[150px]")}
          aria-label="Round type"
        >
          {ROUND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          className={cn(SELECT_CLASS, "w-auto min-w-[150px]")}
          aria-label="Difficulty"
        >
          {DIFFICULTY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <Input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Filter by company…"
          className="h-9 w-full sm:w-56"
          aria-label="Company filter"
        />
      </div>

      <ConsoleCard
        title="Question bank"
        meta={<HeaderCount>{countLabel}</HeaderCount>}
      >
        {/* Loading */}
        {isLoading ? (
          <div className="space-y-2 p-4 sm:px-5" aria-busy="true" aria-label="Loading questions">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : null}

        {/* Error */}
        {isError ? (
          <p role="alert" className="m-0 px-4 py-6 text-sm text-destructive sm:px-5">
            Could not load the question bank.
          </p>
        ) : null}

        {/* Empty state */}
        {!isLoading && !isError && (data?.questions.length ?? 0) === 0 ? (
          <CardEmpty
            title="No questions match the current filters."
            hint="Widen the filters, or run “Collect questions” from the Live ingestion tab to fill the bank."
          />
        ) : null}

        {/* Table */}
        {!isLoading && !isError && (data?.questions.length ?? 0) > 0 ? (
          <HairlineTable label="Questions" className="min-w-[920px]">
            <HairlineHead>
              <Th className="min-w-[260px]">Title</Th>
              <Th className="w-36">Round</Th>
              <Th className="w-28">Difficulty</Th>
              <Th className="min-w-[180px]">Topics</Th>
              <Th className="min-w-[160px]">Companies</Th>
              <Th className="min-w-[120px]">Source</Th>
            </HairlineHead>
            <tbody>
              {data!.questions.map((q) => {
                const extraTopics = q.topic_tags.length > 3 ? q.topic_tags.length - 3 : 0;
                const extraCompanies = q.company_tags.length > 3 ? q.company_tags.length - 3 : 0;
                return (
                  <Tr key={q.slug}>
                    {/* Title */}
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ExtLink href={q.url} className="text-sm">
                          {q.title}
                        </ExtLink>
                        {q.round_type === "lld" && q.is_machine_coding === true && (
                          <LookPill look={OUTLINE_PILL}>machine coding</LookPill>
                        )}
                      </div>
                    </Td>

                    {/* Round */}
                    <Td>
                      <MonoPill tone="soft">{roundLabel(q.round_type)}</MonoPill>
                    </Td>

                    {/* Difficulty */}
                    <Td>
                      {q.difficulty ? (
                        <LookPill look={DIFFICULTY_PILL[q.difficulty] ?? OUTLINE_PILL}>{q.difficulty}</LookPill>
                      ) : (
                        <span className="text-xs text-faint">—</span>
                      )}
                    </Td>

                    {/* Topics */}
                    <Td className="text-[13px] text-muted-foreground">
                      {q.topic_tags.length === 0 ? (
                        <span className="text-xs text-faint">—</span>
                      ) : (
                        <>
                          {q.topic_tags.slice(0, 3).join(", ")}
                          {extraTopics > 0 && (
                            <span className="ml-1 font-mono text-[11px] tabular-nums text-faint">
                              +{extraTopics}
                            </span>
                          )}
                        </>
                      )}
                    </Td>

                    {/* Companies */}
                    <Td className="text-[13px] text-muted-foreground">
                      {q.company_tags.length === 0 ? (
                        <span className="text-xs text-faint">—</span>
                      ) : (
                        <>
                          {q.company_tags.slice(0, 3).join(", ")}
                          {extraCompanies > 0 && (
                            <span className="ml-1 font-mono text-[11px] tabular-nums text-faint">
                              +{extraCompanies}
                            </span>
                          )}
                        </>
                      )}
                    </Td>

                    {/* Sources */}
                    <Td className="font-mono text-[11.5px] text-muted-foreground">
                      {q.sources.join(", ") || "—"}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </HairlineTable>
        ) : null}
      </ConsoleCard>
    </div>
  );
}
