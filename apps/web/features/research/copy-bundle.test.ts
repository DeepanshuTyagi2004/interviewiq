import { describe, expect, it } from "vitest";
import { COPY_BUNDLE_MAX_CHARS } from "@/lib/constants/research";
import { fence, formatFailureReport, formatRunSummary, formatSpanForClaude, trimMiddle } from "./copy-bundle";
import { makeEvent, makeItem, makeRun, makeSpan } from "./testing";

describe("trimMiddle", () => {
  it("keeps short text and trims the middle of long text, saying how much", () => {
    expect(trimMiddle("short", 100)).toBe("short");
    const out = trimMiddle("a".repeat(500) + "b".repeat(500), 200);
    expect(out.length).toBeLessThanOrEqual(240);
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("b")).toBe(true);
    expect(out).toMatch(/\[\d+ chars trimmed\]/);
  });
});

describe("fence", () => {
  it("uses a fence longer than any backtick run inside the body", () => {
    expect(fence("json", "{}")).toBe("```json\n{}\n```");
    expect(fence("text", "has ``` inside")).toBe("````text\nhas ``` inside\n````");
  });
});

describe("formatSpanForClaude", () => {
  const span = {
    ...makeSpan({
      span_id: "s".repeat(32), kind: "llm", name: "resolve_company@v1", company_id: "c-meesho", node: "resolve", status: "error",
      attrs: { model: "gemma-3-27b-it", prompt_name: "resolve_company", prompt_version: "v1" },
      error: { type: "ValidationError", message: "canonical_name missing", traceback: "Traceback…", code_ref: "app/research/nodes/resolve.py:resolve" },
    }),
    input: { system: "sys", user: "x".repeat(100_000) },
    output: { data: { is_company: true } },
  };

  it("leads with run, company, node, model, prompt and the code location, then fenced sections", () => {
    const out = formatSpanForClaude({ span, logs: [makeEvent({ seq: 7, message: "resolve meesho: 5 results" })], run: makeRun(), companyName: "Meesho" });
    expect(out).toContain("## InterviewIQ research trace — llm · resolve_company@v1 · error");
    expect(out).toContain("- company: Meesho");
    expect(out).toContain("- node: resolve");
    expect(out).toContain("- model: gemma-3-27b-it");
    expect(out).toContain("- prompt: resolve_company@v1");
    expect(out).toContain("- code: apps/ai-service/app/research/nodes/resolve.py:resolve");
    for (const section of ["### Error", "### Input", "### Output", "### Attributes", "### Logs"]) expect(out).toContain(section);
    expect(out).toContain("resolve meesho: 5 results");
    expect(out.length).toBeLessThanOrEqual(COPY_BUNDLE_MAX_CHARS + 100);
    expect(out).toMatch(/chars trimmed/);
  });
});

describe("formatFailureReport", () => {
  it("includes the node timeline, the error, previous node outputs and the failing step", () => {
    const item = makeItem({
      status: "failed", last_node: null, nodes: { resolve: { status: "error", error: "ValidationError: canonical_name" } },
      error: { type: "ValidationError", message: "canonical_name missing", traceback: "tb", code_ref: "app/research/nodes/resolve.py:resolve" },
    });
    const failing = { ...makeSpan({ span_id: "f".repeat(32), kind: "llm", name: "resolve_company@v1" }), input: { user: "u" }, output: null };
    const out = formatFailureReport({ run: makeRun(), item, failing, previousOutputs: [{ node: "resolve", output: { partial: 1 } }], logs: [] });
    expect(out).toContain("## InterviewIQ research failure — Meesho (meesho)");
    expect(out).toContain("- resolve: error — ValidationError: canonical_name");
    expect(out).toContain("- code: apps/ai-service/app/research/nodes/resolve.py:resolve");
    expect(out).toContain("### Output of resolve");
    expect(out).toContain("### Failing step: llm · resolve_company@v1");
  });
});

describe("formatRunSummary", () => {
  it("summarises the run and one line per company", () => {
    const out = formatRunSummary(makeRun({ status: "paused", pause_reason: "budget_exhausted" }), [
      makeItem({ status: "done" }),
      makeItem({ company_id: "c2", company_name: "TCS", status: "failed", error: { type: "X", message: "boom", traceback: "", code_ref: null } }),
    ]);
    expect(out).toContain("paused (budget_exhausted)");
    expect(out).toContain("- Meesho: done");
    expect(out).toContain("- TCS: failed — X: boom");
  });
});
