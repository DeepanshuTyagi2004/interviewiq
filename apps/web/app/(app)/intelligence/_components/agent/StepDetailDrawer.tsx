"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LookPill } from "@/components/observability/ConsoleCard";
import { OUTLINE_PILL, STEP_PILL } from "@/components/observability/status";
import type { AgentStep } from "@/features/agent-diagnostics";

/**
 * Detail panel for one AgentStep, opened by clicking a node in PipelineCanvas
 * (or a step in DecisionTimeline). Every `detail` field is optional — `thought`
 * in particular is absent until the ai-service side starts emitting persona
 * reasoning, so every lookup here is null-safe.
 */
export function StepDetailDrawer({
  step,
  onClose,
}: {
  step: AgentStep | null | undefined;
  onClose: () => void;
}) {
  if (!step) return null;

  const d = step.detail ?? {};
  const pill = STEP_PILL[step.status];

  return (
    <section
      aria-label={`Step detail: ${step.name}`}
      className="min-w-0 overflow-hidden rounded-[10px] border border-line-3 bg-card shadow-hairline"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="iq-eyebrow">Step</span>
          <h3 className="m-0 truncate font-mono text-[13px] font-normal">{step.name}</h3>
          <LookPill look={pill ?? OUTLINE_PILL}>{step.status}</LookPill>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="-mr-2 shrink-0 text-muted-foreground">
          <X aria-hidden /> Close
        </Button>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2">
          {step.llm_label != null && (
            <div className="space-y-0.5">
              <dt className="iq-eyebrow">Model</dt>
              <dd className="m-0 font-mono text-[13px]">{step.llm_label}</dd>
            </div>
          )}
          {step.duration_ms != null && (
            <div className="space-y-0.5">
              <dt className="iq-eyebrow">Duration</dt>
              <dd className="m-0 font-mono text-[13px] tabular-nums">{step.duration_ms}ms</dd>
            </div>
          )}
          {d.llm_ms != null && (
            <div className="space-y-0.5">
              <dt className="iq-eyebrow">Model time</dt>
              <dd className="m-0 font-mono text-[13px] tabular-nums">{String(d.llm_ms)}ms</dd>
            </div>
          )}
          {(d.prompt_tokens != null || d.completion_tokens != null) && (
            <div className="space-y-0.5">
              <dt className="iq-eyebrow">Tokens</dt>
              <dd className="m-0 font-mono text-[13px] tabular-nums">
                {String(d.prompt_tokens ?? "?")} in / {String(d.completion_tokens ?? "?")} out
              </dd>
            </div>
          )}
        </dl>

        {d.branch_reason != null && (
          <div className="rounded-[8px] bg-panel px-3 py-2.5 text-sm">
            <span className="iq-eyebrow mr-2">Why</span>
            {String(d.branch_reason)}
          </div>
        )}

        {d.prompt_system != null && <MonoField label="System prompt" value={String(d.prompt_system)} />}
        {d.prompt_user != null && <MonoField label="User prompt" value={String(d.prompt_user)} />}
        {d.raw_response != null && <MonoField label="Raw response" value={String(d.raw_response)} />}
        {d.parsed_output !== undefined && <JsonField label="Parsed output" value={d.parsed_output} />}
        {d.thought != null && <MonoField label="Reasoning" value={String(d.thought)} />}
        {d.inputs !== undefined && <JsonField label="Inputs" value={d.inputs} />}
        {d.decision !== undefined && <JsonField label="Decision" value={d.decision} />}
      </div>
    </section>
  );
}

function MonoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="iq-eyebrow m-0">{label}</p>
      <pre
        tabIndex={0}
        role="region"
        aria-label={label}
        className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-panel p-3 font-mono text-xs leading-relaxed [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {value}
      </pre>
    </div>
  );
}

function JsonField({ label, value }: { label: string; value: unknown }) {
  return <MonoField label={label} value={JSON.stringify(value, null, 2)} />;
}
