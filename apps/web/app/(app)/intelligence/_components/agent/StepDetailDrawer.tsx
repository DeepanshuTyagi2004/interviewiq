"use client";

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

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{step.name}</h3>
          <span className="text-xs text-muted-foreground">{step.status}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {step.llm_label != null && (
          <div className="flex gap-1">
            <dt className="font-medium">Model:</dt>
            <dd>{step.llm_label}</dd>
          </div>
        )}
        {step.duration_ms != null && (
          <div className="flex gap-1">
            <dt className="font-medium">Duration:</dt>
            <dd>{step.duration_ms}ms</dd>
          </div>
        )}
      </dl>

      {d.prompt_system != null && <MonoField label="System prompt" value={String(d.prompt_system)} />}
      {d.prompt_user != null && <MonoField label="User prompt" value={String(d.prompt_user)} />}
      {d.raw_response != null && <MonoField label="Raw response" value={String(d.raw_response)} />}
      {d.parsed_output !== undefined && <JsonField label="Parsed output" value={d.parsed_output} />}
      {d.thought != null && <MonoField label="Reasoning" value={String(d.thought)} />}
      {d.inputs !== undefined && <JsonField label="Inputs" value={d.inputs} />}
      {d.decision !== undefined && <JsonField label="Decision" value={d.decision} />}
      {d.branch_reason != null && (
        <p className="text-sm">
          <span className="font-medium">Why:</span> {String(d.branch_reason)}
        </p>
      )}
    </div>
  );
}

function MonoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 font-mono text-xs">
        {value}
      </pre>
    </div>
  );
}

function JsonField({ label, value }: { label: string; value: unknown }) {
  return <MonoField label={label} value={JSON.stringify(value, null, 2)} />;
}
