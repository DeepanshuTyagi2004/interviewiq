"use client";
import { useState } from "react";
import type { AgentSessionStatus, SubmitTurnBody } from "@/features/agent-diagnostics";

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
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={!enabled}
                placeholder="Candidate turn…" className="w-full border rounded p-2" />
      <details><summary>Artifact (code/diagram)</summary>
        <textarea value={artifact} onChange={(e) => setArtifact(e.target.value)} disabled={!enabled}
                  className="w-full border rounded p-2 font-mono text-sm" /></details>
      <div className="flex items-center gap-2">
        <label className="text-sm">advance&nbsp;
          <input type="number" value={advance} min={0} onChange={(e) => setAdvance(+e.target.value)}
                 disabled={!enabled} className="w-20 border rounded px-1" />s</label>
        <button disabled={!enabled} onClick={() => {
          onSubmit({ text, advance_seconds: advance,
                     artifact: artifact ? { kind: "code", content: artifact } : undefined });
          setText("");
        }}>Send</button>
        <button disabled={!enabled} onClick={() => onSilence(advance)}>Simulate silence</button>
        <button onClick={onEnd}>End</button>
      </div>
    </div>
  );
}
