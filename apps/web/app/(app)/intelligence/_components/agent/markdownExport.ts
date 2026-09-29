import type { AgentSession, AgentTurn } from "@/features/agent-diagnostics";

export function turnToMarkdown(turn: AgentTurn, notes?: string): string {
  const lines: string[] = [`### Turn ${turn.index} (${turn.kind}) — elapsed ${turn.elapsed_s_at_turn}s`];
  if (turn.candidate_text) lines.push(`**Candidate:** ${turn.candidate_text}`);
  for (const s of turn.steps) {
    lines.push(`\n#### ${s.name} — \`${s.status}\`${s.llm_label ? ` (${s.llm_label})` : ""}`);
    const d = s.detail || {};
    if (d.branch_reason) lines.push(`- why: ${String(d.branch_reason)}`);
    if (d.decision !== undefined) lines.push(`- decision: \`${JSON.stringify(d.decision)}\``);
    if (d.inputs !== undefined) lines.push(`- inputs: \`${JSON.stringify(d.inputs)}\``);
    if (d.prompt_user) lines.push(`- prompt:\n\`\`\`\n${String(d.prompt_user)}\n\`\`\``);
    if (d.raw_response) lines.push(`- response:\n\`\`\`\n${String(d.raw_response)}\n\`\`\``);
    if (d.prompt_system) lines.push(`- system:\n\`\`\`\n${String(d.prompt_system)}\n\`\`\``);
    if (d.thought) lines.push(`- reasoning:\n\`\`\`\n${String(d.thought)}\n\`\`\``);
  }
  if (notes) lines.push(`\n> Notes: ${notes}`);
  return lines.join("\n");
}

export function sessionToMarkdown(session: AgentSession, notes: Record<number, string> = {}): string {
  const head = [`# Agent Diagnostic — ${session.label}`,
    `status: ${session.status}${session.ended_reason ? ` (${session.ended_reason})` : ""}`, ""];
  const turns = session.turns.map((t) => turnToMarkdown(t, notes[t.index]));
  const logs = ["\n## Logs", "```", ...session._logs.map((l) => `[${l.level}] ${l.message}`), "```"];
  return [...head, ...turns, ...logs].join("\n\n");
}
