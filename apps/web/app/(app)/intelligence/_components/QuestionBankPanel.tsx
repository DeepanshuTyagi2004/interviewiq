"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuestions, type Question } from "@/features/intelligence";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

function difficultyVariant(
  d: Question["difficulty"],
): "default" | "secondary" | "destructive" | "outline" {
  if (d === "easy") return "secondary";
  if (d === "hard") return "destructive";
  return "outline";
}

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

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={roundType}
          onChange={(e) => setRoundType(e.target.value)}
          className={selectClass}
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
          className={selectClass}
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
          className="h-9 w-48"
          aria-label="Company filter"
        />

        <span className="ml-auto text-sm text-muted-foreground">
          {data
            ? (data.returned ?? data.questions.length) < data.count
              ? `Showing ${data.returned ?? data.questions.length} of ${data.count} ingested`
              : `${data.count} questions ingested`
            : "0 questions ingested"}
        </span>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the question bank.
        </p>
      )}

      {/* Empty state */}
      {!isLoading && !isError && data?.questions.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No questions match the current filters.
        </p>
      )}

      {/* Table */}
      {!isLoading && !isError && (data?.questions.length ?? 0) > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px]">Title</TableHead>
                <TableHead className="w-32">Round</TableHead>
                <TableHead className="w-28">Difficulty</TableHead>
                <TableHead className="min-w-[180px]">Topics</TableHead>
                <TableHead className="min-w-[160px]">Companies</TableHead>
                <TableHead className="min-w-[120px]">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.questions.map((q) => {
                const extraTopics = q.topic_tags.length > 3 ? q.topic_tags.length - 3 : 0;
                const extraCompanies = q.company_tags.length > 3 ? q.company_tags.length - 3 : 0;
                return (
                  <TableRow key={q.slug}>
                    {/* Title */}
                    <TableCell className="font-medium">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={q.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {q.title}
                        </a>
                        {q.round_type === "lld" && q.is_machine_coding === true && (
                          <Badge variant="outline" className="text-[10px]">
                            machine coding
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    {/* Round */}
                    <TableCell>
                      <Badge variant="secondary">{roundLabel(q.round_type)}</Badge>
                    </TableCell>

                    {/* Difficulty */}
                    <TableCell>
                      {q.difficulty ? (
                        <Badge variant={difficultyVariant(q.difficulty)}>
                          {q.difficulty}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Topics */}
                    <TableCell className="text-sm text-muted-foreground">
                      {q.topic_tags.length === 0 ? (
                        <span className="text-xs">—</span>
                      ) : (
                        <>
                          {q.topic_tags.slice(0, 3).join(", ")}
                          {extraTopics > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              +{extraTopics}
                            </span>
                          )}
                        </>
                      )}
                    </TableCell>

                    {/* Companies */}
                    <TableCell className="text-sm text-muted-foreground">
                      {q.company_tags.length === 0 ? (
                        <span className="text-xs">—</span>
                      ) : (
                        <>
                          {q.company_tags.slice(0, 3).join(", ")}
                          {extraCompanies > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              +{extraCompanies}
                            </span>
                          )}
                        </>
                      )}
                    </TableCell>

                    {/* Sources */}
                    <TableCell className="text-xs text-muted-foreground">
                      {q.sources.join(", ") || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
