import { describe, expect, it } from "vitest";
import { buildSpanTree, countSpans, deepestErrorSpan, flattenVisible, nodeSpansFor } from "./trace-tree";
import { makeSpan } from "./testing";

const t = (s: number) => `2026-10-02T10:00:${String(s).padStart(2, "0")}+00:00`;
const SPANS = [
  makeSpan({ span_id: "run", kind: "run", name: "run", started_at: t(0) }),
  makeSpan({ span_id: "co", parent_id: "run", kind: "company", name: "Meesho", company_id: "c1", started_at: t(1) }),
  makeSpan({ span_id: "draft", parent_id: "co", kind: "node", name: "write_draft", company_id: "c1", started_at: t(5) }),
  makeSpan({ span_id: "resolve", parent_id: "co", kind: "node", name: "resolve", company_id: "c1", status: "error", started_at: t(2) }),
  makeSpan({ span_id: "llm", parent_id: "resolve", kind: "llm", name: "resolve_company@v1", company_id: "c1", status: "error", started_at: t(3) }),
  makeSpan({ span_id: "orphan", parent_id: "gone", kind: "exa", name: "q", started_at: t(9) }),
];

describe("buildSpanTree", () => {
  it("nests by parent, orders children by start time, and keeps orphans as roots", () => {
    const roots = buildSpanTree(SPANS);
    expect(roots.map((r) => r.span.span_id)).toEqual(["run", "orphan"]);
    const company = roots[0]!.children[0]!;
    expect(company.children.map((c) => c.span.name)).toEqual(["resolve", "write_draft"]);
    expect(company.children[0]!.children[0]!.depth).toBe(3);
  });

  it("bubbles errors up to every ancestor", () => {
    const [run] = buildSpanTree(SPANS);
    expect(run!.hasError).toBe(true);
    expect(run!.children[0]!.hasError).toBe(true);
    expect(run!.children[0]!.children[1]!.hasError).toBe(false);
  });

  it("flattenVisible hides the children of collapsed spans", () => {
    const roots = buildSpanTree(SPANS);
    expect(flattenVisible(roots, new Set()).map((n) => n.span.span_id)).toEqual(["run", "co", "resolve", "llm", "draft", "orphan"]);
    expect(flattenVisible(roots, new Set(["co"])).map((n) => n.span.span_id)).toEqual(["run", "co", "orphan"]);
    expect(countSpans(roots)).toBe(6);
  });

  it("finds the innermost failing step and the company's node spans", () => {
    const roots = buildSpanTree(SPANS);
    expect(deepestErrorSpan(roots, "c1")?.span_id).toBe("llm");
    expect(deepestErrorSpan(roots, "nope")).toBeNull();
    expect(nodeSpansFor(roots, "c1").map((s) => s.name)).toEqual(["resolve", "write_draft"]);
  });
});
