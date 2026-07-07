"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns";
import { RunConsole } from "@/components/observability/RunConsole";
import { RunLogStream } from "@/components/observability/RunLogStream";
import { TranscriptPanel } from "@/features/interview-live/work/TranscriptPanel";
import { useJds } from "@/features/jobs";
import { usePrepCandidates, usePrepRun, useStartPrepRun } from "@/features/interview-prep-bench";
import type { AgentStep } from "@/features/agent-diagnostics";
import {
  isSessionTerminal,
  useAgentSession,
  useEndAgentSession,
  useStartAgentSession,
  useSubmitTurn,
} from "@/features/agent-diagnostics";
import { DecisionTimeline } from "./agent/DecisionTimeline";
import { LatencySummary } from "./agent/LatencySummary";
import { PipelineCanvas } from "./agent/PipelineCanvas";
import { StepDetailDrawer } from "./agent/StepDetailDrawer";
import { TurnComposer } from "./agent/TurnComposer";
import { sessionToMarkdown } from "./agent/markdownExport";

// Copied verbatim from InterviewPrepBenchPanel.tsx.
const SELECT_CLASS =
  "rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Admin test-bench for the live-interview agent's decision engine. Phase machine:
 *  - idle:    pick a JD (+ optional candidate) and run the prep pipeline to get an InterviewPlan.
 *  - prep:    watch plan generation (reuses the interview-prep bench's RunConsole).
 *  - session: once a plan exists, start an instrumented agent session and drive it turn by
 *             turn — the composer is only enabled while the agent is `awaiting_input` — while
 *             watching the decision trail (clarify vs advance, silence handling, why the agent
 *             ends) and the raw log stream. The finished session can be copied out as Markdown.
 */
export function AgentDiagnosticsPanel() {
  const jds = useJds();
  const candidates = usePrepCandidates();
  const [jobDescriptionId, setJobDescriptionId] = React.useState("");
  const [candidateId, setCandidateId] = React.useState("");

  const startPrep = useStartPrepRun();
  const [prepRunId, setPrepRunId] = React.useState<string | null>(null);
  const prep = usePrepRun(prepRunId);

  const startSession = useStartAgentSession();
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const session = useAgentSession(sessionId);
  const submitTurn = useSubmitTurn();
  const endSession = useEndAgentSession();

  // Pipeline-canvas / step-detail state: which turn's steps are shown on the canvas,
  // which step's detail (incl. `thought`) is open in the drawer, and free-text notes
  // keyed by AgentTurn.index (not array position) so they line up with what
  // sessionToMarkdown looks up per turn. `manualTurn` records whether the admin took
  // over the turn selector; `selectedTurn` only matters once they have.
  const [selectedTurn, setSelectedTurn] = React.useState(0);
  const [manualTurn, setManualTurn] = React.useState(false);
  const [selectedStep, setSelectedStep] = React.useState<AgentStep | null>(null);
  const [notes, setNotes] = React.useState<Record<number, string>>({});

  const turns = session.data?.turns ?? [];
  // §8.3: while the session is live and the admin hasn't manually picked a turn, the
  // canvas auto-follows whichever turn just ran (session.data.current_turn), so new
  // turns surface as they arrive instead of the view staying pinned to turn 0. Once
  // the admin picks a turn from the selector, their choice sticks. Derived during
  // render (rather than synced via an effect) to avoid a cascading-render setState.
  const effectiveTurn = manualTurn ? selectedTurn : (session.data?.current_turn ?? 0);
  const clampedTurnIdx = turns.length === 0 ? 0 : Math.min(Math.max(effectiveTurn, 0), turns.length - 1);
  const currentTurn = turns[clampedTurnIdx];

  const plan = prep.data?.status === "completed" ? prep.data.result : null;
  const canRunPrep = Boolean(jobDescriptionId) && !startPrep.isPending;

  const onRunPrep = () => {
    if (!canRunPrep) return;
    startPrep.mutate(
      { jobDescriptionId, candidateId: candidateId.trim() || undefined },
      { onSuccess: (res) => setPrepRunId(res.run_id) },
    );
  };

  const onStartSession = () => {
    if (plan == null || startSession.isPending) return;
    startSession.mutate(plan, { onSuccess: (res) => setSessionId(res.run_id) });
  };

  const onCopyMarkdown = () => {
    if (!session.data) return;
    void navigator.clipboard.writeText(sessionToMarkdown(session.data, notes));
  };

  // Spec §8.1: restart resets. Clear all run state back to the idle phase (JD/candidate pickers)
  // so the admin can run another session without reloading the page. The JD/candidate selection
  // is intentionally kept so a follow-up run against the same role is one click away.
  const onReset = () => {
    setSessionId(null);
    setPrepRunId(null);
    setSelectedTurn(0);
    setManualTurn(false);
    setSelectedStep(null);
    setNotes({});
  };

  const sessionEnded = isSessionTerminal(session.data?.status);

  return (
    <div className="space-y-6">
      {!sessionId && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <p className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
            Drives the live-interview agent outside a real session: generate an InterviewPlan,
            then step through turns to inspect every decision the agent makes — clarify vs.
            advance, silence handling, and why it chooses to end.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Job description</span>
              <select
                className={SELECT_CLASS}
                value={jobDescriptionId}
                onChange={(e) => setJobDescriptionId(e.target.value)}
              >
                <option value="">{jds.isLoading ? "Loading roles…" : "Select a role"}</option>
                {(jds.data ?? []).map((jd) => (
                  <option key={jd.id} value={jd.id}>
                    {jd.companyName} — {jd.title} ({jd.level})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Candidate (optional)</span>
              <select
                className={SELECT_CLASS}
                value={candidateId}
                onChange={(e) => setCandidateId(e.target.value)}
              >
                <option value="">
                  {candidates.isLoading ? "Loading candidates…" : "No candidate (JD-only grounding)"}
                </option>
                {(candidates.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.email ? ` — ${c.email}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <Button onClick={onRunPrep} disabled={!canRunPrep}>
              {startPrep.isPending ? "Starting…" : "Run prep"}
            </Button>

            {plan != null && (
              <Button variant="secondary" onClick={onStartSession} disabled={startSession.isPending}>
                {startSession.isPending ? "Starting session…" : "Start session"}
              </Button>
            )}
          </div>
          {startPrep.isError && (
            <span className="text-sm text-destructive">{(startPrep.error as Error).message}</span>
          )}
          {startSession.isError && (
            <span className="text-sm text-destructive">{(startSession.error as Error).message}</span>
          )}
        </div>
      )}

      {!sessionId && prepRunId && (
        prep.data ? (
          <RunConsole snapshot={prep.data} resultTitle="Generated InterviewPlan" />
        ) : (
          <p className="text-sm text-muted-foreground">Starting run…</p>
        )
      )}

      {!sessionId && !prepRunId && (
        <EmptyState
          title="No session yet"
          hint="Pick a role, generate an InterviewPlan, then “Start session” to drive the agent turn by turn."
        />
      )}

      {sessionId && session.data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
          <div className="space-y-3">
            <div className="h-[42vh] min-h-64">
              <TranscriptPanel
                entries={session.data.transcript}
                interviewerName={String(session.data.plan_summary.persona_name ?? "Interviewer")}
              />
            </div>
            <TurnComposer
              status={session.data.status}
              onSubmit={(body) => submitTurn.mutate({ runId: sessionId, body })}
              onSilence={(advanceSeconds) =>
                submitTurn.mutate({
                  runId: sessionId,
                  body: { silence: true, advance_seconds: advanceSeconds },
                })
              }
              onEnd={() => endSession.mutate(sessionId)}
            />
            {submitTurn.isError && (
              <span className="text-sm text-destructive">
                Turn failed: {(submitTurn.error as Error).message}
              </span>
            )}
            {endSession.isError && (
              <span className="text-sm text-destructive">
                End failed: {(endSession.error as Error).message}
              </span>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={onCopyMarkdown}>
                Copy as Markdown
              </Button>
              {sessionEnded && (
                <Button variant="secondary" size="sm" onClick={onReset}>
                  Start new session
                </Button>
              )}
            </div>
            {(sessionEnded || session.data.ended_reason) && (
              <p className="text-sm">
                Ended: <strong>{session.data.ended_reason ?? session.data.status}</strong>
              </p>
            )}
          </div>
          <div className="space-y-3">
            {selectedStep && (
              <StepDetailDrawer step={selectedStep} onClose={() => setSelectedStep(null)} />
            )}
            {turns.length > 0 ? (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Turn</span>
                  <select
                    className={SELECT_CLASS}
                    value={clampedTurnIdx}
                    onChange={(e) => {
                      setManualTurn(true);
                      setSelectedTurn(Number(e.target.value));
                      setSelectedStep(null);
                    }}
                  >
                    {turns.map((t, i) => (
                      <option key={t.index} value={i}>
                        Turn {t.index} — {t.kind}
                      </option>
                    ))}
                  </select>
                </label>
                <PipelineCanvas turn={currentTurn} onSelectStep={(step) => setSelectedStep(step ?? null)} />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Notes for turn {currentTurn?.index ?? clampedTurnIdx}</span>
                  <textarea
                    className="w-full rounded-md border border-border bg-background p-2 text-sm"
                    rows={3}
                    value={(currentTurn && notes[currentTurn.index]) ?? ""}
                    onChange={(e) => {
                      const idx = currentTurn?.index ?? clampedTurnIdx;
                      const value = e.target.value;
                      setNotes((prev) => ({ ...prev, [idx]: value }));
                    }}
                  />
                </label>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No turns yet.</p>
            )}
            <LatencySummary turns={session.data.turns} />
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-border p-1">
              <DecisionTimeline
                turns={session.data.turns}
                onSelectStep={(turnIndex, stepIndex) =>
                  setSelectedStep(
                    session.data?.turns.find((t) => t.index === turnIndex)?.steps[stepIndex] ?? null,
                  )
                }
              />
            </div>
            <div className="max-h-64 overflow-auto">
              <RunLogStream logs={session.data._logs} />
            </div>
          </div>
        </div>
      )}

      {sessionId && !session.data && (
        <p className="text-sm text-muted-foreground">Starting session…</p>
      )}
    </div>
  );
}
