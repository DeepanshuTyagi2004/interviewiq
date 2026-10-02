"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { HudCard, StatusDot } from "@/components/hud";
import { EmptyState, FormField } from "@/components/patterns";
import { ConsoleCard } from "@/components/observability/ConsoleCard";
import { RunConsole } from "@/components/observability/RunConsole";
import { RunLogStream } from "@/components/observability/RunLogStream";
import { TranscriptPanel } from "@/features/interview-live/work/TranscriptPanel";
import { useJds } from "@/features/jobs";
import { cn } from "@/lib/utils/cn";
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
import { SELECT_CLASS, TEXTAREA_CLASS } from "./fields";
import { SESSION_DOT } from "./pills";

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
  const ids = React.useId();

  return (
    <div className="space-y-4">
      {!sessionId && (
        <ConsoleCard title="New session">
          <div className="space-y-4 p-4 sm:p-5">
            <p className="m-0 rounded-[11px] bg-panel px-3.5 py-3 text-[13px] leading-[1.55] text-muted-foreground">
              Drives the live-interview agent outside a real session: generate an InterviewPlan,
              then step through turns to inspect every decision the agent makes — clarify vs.
              advance, silence handling, and why it chooses to end.
            </p>
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
              <FormField label="Job description" htmlFor={`${ids}-jd`} className="min-w-0 md:w-[320px]">
                <select
                  id={`${ids}-jd`}
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
              </FormField>

              <FormField label="Candidate (optional)" htmlFor={`${ids}-candidate`} className="min-w-0 md:w-[320px]">
                <select
                  id={`${ids}-candidate`}
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
              </FormField>

              <div className="flex flex-wrap gap-2">
                {/* Once a plan exists, starting the session is the next step, so it takes the brand. */}
                <Button variant={plan != null ? "outline" : "default"} onClick={onRunPrep} disabled={!canRunPrep}>
                  {startPrep.isPending ? "Starting…" : "Run prep"}
                </Button>

                {plan != null && (
                  <Button onClick={onStartSession} disabled={startSession.isPending}>
                    {startSession.isPending ? "Starting session…" : "Start session"}
                  </Button>
                )}
              </div>
            </div>
            {startPrep.isError && (
              <p role="alert" className="m-0 text-sm text-destructive">{(startPrep.error as Error).message}</p>
            )}
            {startSession.isError && (
              <p role="alert" className="m-0 text-sm text-destructive">{(startSession.error as Error).message}</p>
            )}
          </div>
        </ConsoleCard>
      )}

      {!sessionId && prepRunId && (
        prep.data ? (
          <RunConsole snapshot={prep.data} resultTitle="Generated InterviewPlan" />
        ) : (
          <p className="m-0 text-sm text-muted-foreground">Starting run…</p>
        )
      )}

      {!sessionId && !prepRunId && (
        <EmptyState
          title="No session yet"
          hint="Pick a role, generate an InterviewPlan, then “Start session” to drive the agent turn by turn."
        />
      )}

      {sessionId && session.data && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="iq-eyebrow m-0">Session</p>
                <p className="m-0 mt-1 truncate text-[15px] tracking-[-0.01em]">{session.data.label}</p>
              </div>
              {/* Pulses only while the session is live (running, or waiting on the next turn). */}
              <StatusDot
                state={SESSION_DOT[session.data.status] ?? "idle"}
                label={session.data.status.replace(/_/g, " ")}
                className={session.data.status === "failed" ? "text-destructive" : "text-muted-foreground"}
              />
            </div>
            {/* TranscriptPanel is shared with the live room; the frame around it is ours. */}
            <HudCard as="div" className="h-[calc(42vh/var(--hud-zoom,1))] min-h-64" bodyClassName="min-h-0 p-3">
              <TranscriptPanel
                entries={session.data.transcript}
                interviewerName={String(session.data.plan_summary.persona_name ?? "Interviewer")}
              />
            </HudCard>
            <HudCard as="div" bodyClassName="p-3 sm:p-4">
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
            </HudCard>
            {submitTurn.isError && (
              <p role="alert" className="m-0 text-sm text-destructive">
                Turn failed: {(submitTurn.error as Error).message}
              </p>
            )}
            {endSession.isError && (
              <p role="alert" className="m-0 text-sm text-destructive">
                End failed: {(endSession.error as Error).message}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={onCopyMarkdown}>
                Copy as Markdown
              </Button>
              {sessionEnded && (
                <Button variant="strong" size="sm" onClick={onReset}>
                  Start new session
                </Button>
              )}
            </div>
            {(sessionEnded || session.data.ended_reason) && (
              <p className="m-0 text-sm text-muted-foreground">
                Ended: <span className="font-mono text-[13px] text-foreground">{session.data.ended_reason ?? session.data.status}</span>
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-3">
            {selectedStep && (
              <StepDetailDrawer step={selectedStep} onClose={() => setSelectedStep(null)} />
            )}
            {turns.length > 0 ? (
              <ConsoleCard
                title="Pipeline"
                meta={
                  <label className="flex items-center gap-2 text-xs text-faint">
                    Turn
                    {/* font-sans: the HUD header's meta slot is mono; the control keeps the app's face. */}
                    <select
                      className={cn(SELECT_CLASS, "h-8 w-auto min-w-[140px] font-sans text-[13px]")}
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
                }
              >
                <PipelineCanvas turn={currentTurn} onSelectStep={(step) => setSelectedStep(step ?? null)} />
                <div className="border-t border-line p-4 sm:px-5">
                  <FormField label={`Notes for turn ${currentTurn?.index ?? clampedTurnIdx}`} htmlFor={`${ids}-notes`}>
                    <textarea
                      id={`${ids}-notes`}
                      className={TEXTAREA_CLASS}
                      rows={3}
                      value={(currentTurn && notes[currentTurn.index]) ?? ""}
                      onChange={(e) => {
                        const idx = currentTurn?.index ?? clampedTurnIdx;
                        const value = e.target.value;
                        setNotes((prev) => ({ ...prev, [idx]: value }));
                      }}
                    />
                  </FormField>
                </div>
              </ConsoleCard>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">No turns yet.</p>
            )}
            <LatencySummary turns={session.data.turns} />
            <ConsoleCard title="Decision timeline">
              <div
                role="region"
                aria-label="Decision timeline steps"
                tabIndex={0}
                className="max-h-[calc(45vh/var(--hud-zoom,1))] overflow-auto [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <DecisionTimeline
                  turns={session.data.turns}
                  onSelectStep={(turnIndex, stepIndex) =>
                    setSelectedStep(
                      session.data?.turns.find((t) => t.index === turnIndex)?.steps[stepIndex] ?? null,
                    )
                  }
                />
              </div>
            </ConsoleCard>
            <RunLogStream logs={session.data._logs} className="h-64" />
          </div>
        </div>
      )}

      {sessionId && !session.data && (
        <p className="m-0 text-sm text-muted-foreground">Starting session…</p>
      )}
    </div>
  );
}
