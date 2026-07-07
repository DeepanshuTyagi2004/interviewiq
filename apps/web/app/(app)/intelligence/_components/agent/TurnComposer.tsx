"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { AgentSessionStatus, SubmitTurnBody } from "@/features/agent-diagnostics";

// Match the dark-theme token classes used elsewhere (SELECT_CLASS in the panel). Without these a
// bare <textarea> renders as a white box with near-invisible text against the dark shell.
const FIELD =
  "w-full rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export function TurnComposer({ status, onSubmit, onSilence, onEnd }: {
  status: AgentSessionStatus;
  onSubmit: (b: SubmitTurnBody) => void;
  onSilence: (advanceSeconds: number) => void;
  onEnd: () => void;
}) {
  const [text, setText] = useState("");
  const [artifact, setArtifact] = useState("");
  const [advance, setAdvance] = useState(60);
  const enabled = status === "awaiting_input";

  const send = () => {
    if (!enabled || !text.trim()) return;
    onSubmit({
      text,
      advance_seconds: advance,
      artifact: artifact ? { kind: "code", content: artifact } : undefined,
    });
    setText("");
  };

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        disabled={!enabled}
        rows={2}
        placeholder={enabled ? "Candidate turn…  (Enter to send · Shift+Enter for a newline)" : "Waiting for the agent…"}
        className={FIELD}
      />
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">Artifact (code/diagram)</summary>
        <textarea
          value={artifact}
          onChange={(e) => setArtifact(e.target.value)}
          disabled={!enabled}
          rows={4}
          placeholder="Paste code or a diagram summary (grades on DSA/LLD/SD rounds)…"
          className={cn(FIELD, "mt-1 font-mono")}
        />
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          advance
          <input
            type="number"
            value={advance}
            min={0}
            onChange={(e) => setAdvance(Number(e.target.value))}
            disabled={!enabled}
            className="w-16 rounded-md border border-border bg-background text-foreground px-2 py-1 text-sm disabled:opacity-50"
          />
          s
        </label>
        <Button size="sm" onClick={send} disabled={!enabled}>Send</Button>
        <Button size="sm" variant="outline" onClick={() => onSilence(advance)} disabled={!enabled}>
          Simulate silence
        </Button>
        <Button size="sm" variant="ghost" onClick={onEnd}>End</Button>
      </div>
    </div>
  );
}
