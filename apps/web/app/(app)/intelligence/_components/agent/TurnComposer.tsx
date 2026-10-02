"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { AgentSessionStatus, SubmitTurnBody } from "@/features/agent-diagnostics";
import { TEXTAREA_CLASS } from "../fields";

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
    <div className="space-y-3">
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
        aria-label="Candidate turn"
        placeholder={enabled ? "Candidate turn…  (Enter to send · Shift+Enter for a newline)" : "Waiting for the agent…"}
        className={TEXTAREA_CLASS}
      />
      <details className="group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
          Artifact (code/diagram)
        </summary>
        <textarea
          value={artifact}
          onChange={(e) => setArtifact(e.target.value)}
          disabled={!enabled}
          rows={4}
          aria-label="Artifact"
          placeholder="Paste code or a diagram summary (grades on DSA/LLD/SD rounds)…"
          className={cn(TEXTAREA_CLASS, "mt-2 font-mono text-xs")}
        />
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          Advance
          <input
            type="number"
            value={advance}
            min={0}
            onChange={(e) => setAdvance(Number(e.target.value))}
            disabled={!enabled}
            className="h-8 w-16 rounded-full border border-input bg-card px-2 font-mono text-[13px] tabular-nums text-foreground transition-colors focus-visible:border-faint focus-visible:ring-[3px] focus-visible:ring-foreground/10 focus-visible:outline-none disabled:opacity-50"
          />
          s
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onEnd}>End</Button>
          <Button size="sm" variant="outline" onClick={() => onSilence(advance)} disabled={!enabled}>
            Simulate silence
          </Button>
          <Button size="sm" onClick={send} disabled={!enabled}>Send</Button>
        </div>
      </div>
    </div>
  );
}
