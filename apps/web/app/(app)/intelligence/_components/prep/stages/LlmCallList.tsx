"use client";

import type { ReactNode } from "react";
import { LookPill } from "@/components/observability/ConsoleCard";
import { GHOST_PILL, OUTLINE_PILL } from "@/components/observability/status";
import type { BlueprintLlmCall } from "@/features/blueprints";
import { formatCount, formatMs } from "../format";
import { Collapsible, Lines, MonoBlock, PassMark, Section } from "../ui";

/**
 * Every LLM call (and sandbox check) recorded on a stage, in order: label, attempt, provider/model,
 * latency, tokens, validity with the validation errors, and the prompts and raw reply on demand.
 */
export function LlmCallList({ calls }: { calls: BlueprintLlmCall[] | undefined }) {
  const list = calls ?? [];
  return (
    <Section title={`LLM calls · ${list.length}`}>
      {list.length === 0 ? (
        <p className="m-0 text-xs text-faint">No LLM calls recorded on this stage.</p>
      ) : (
        <ol className="m-0 list-none space-y-2 p-0">
          {list.map((call, i) => (
            <li key={i}>{call.sandbox ? <SandboxCall call={call} /> : <LlmCall call={call} />}</li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function Header({ call, children }: { call: BlueprintLlmCall; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-0 font-mono text-[12.5px] [overflow-wrap:anywhere]">{call.label ?? "call"}</span>
      {call.attempt != null ? <LookPill look={call.attempt > 1 ? OUTLINE_PILL : GHOST_PILL}>attempt {call.attempt}</LookPill> : null}
      {children}
    </div>
  );
}

function SandboxCall({ call }: { call: BlueprintLlmCall }) {
  const ok = call.valid === true;
  return (
    <div className="rounded-[12px] border border-line-2 px-3 py-2.5">
      <Header call={call}>
        <LookPill look={OUTLINE_PILL}>sandbox</LookPill>
        <span className="ml-auto">
          <PassMark ok={ok} yes="passed" no="failed" />
        </span>
      </Header>
      {call.validation_errors?.length ? (
        <div className="mt-2">
          <Lines items={call.validation_errors} mono />
        </div>
      ) : null}
      {call.error ? <p className="m-0 mt-2 font-mono text-[12px] text-destructive">{call.error}</p> : null}
    </div>
  );
}

function LlmCall({ call }: { call: BlueprintLlmCall }) {
  const model = [call.provider, call.model].filter(Boolean).join("/");
  const prompt = call.tokens?.prompt;
  const completion = call.tokens?.completion;
  return (
    <div className="space-y-2 rounded-[12px] border border-line-2 px-3 py-2.5">
      <Header call={call}>
        <span className="ml-auto">
          {call.error ? <PassMark ok={false} no="error" /> : call.valid != null ? <PassMark ok={call.valid} /> : null}
        </span>
      </Header>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11.5px] text-muted-foreground">
        <span>{model || "model —"}</span>
        <span>{formatMs(call.latency_ms)}</span>
        <span>
          {prompt != null ? formatCount(prompt) : "—"} in · {completion != null ? formatCount(completion) : "—"} out
        </span>
        {call.attempts != null && call.attempts > 1 ? <span>{call.attempts} provider attempts</span> : null}
      </p>
      {call.validation_errors?.length ? (
        <div>
          <p className="iq-eyebrow m-0 mb-1 text-destructive">Validation errors</p>
          <Lines items={call.validation_errors} mono />
        </div>
      ) : null}
      {call.error ? <p className="m-0 font-mono text-[12px] text-destructive [overflow-wrap:anywhere]">{call.error}</p> : null}
      {call.system ? (
        <Collapsible summary="System prompt">
          <MonoBlock label="System prompt" text={call.system} />
        </Collapsible>
      ) : null}
      {call.user ? (
        <Collapsible summary="User prompt">
          <MonoBlock label="User prompt" text={call.user} />
        </Collapsible>
      ) : null}
      {call.raw ? (
        <Collapsible summary="Raw reply">
          <MonoBlock label="Raw reply" text={call.raw} />
        </Collapsible>
      ) : null}
    </div>
  );
}
