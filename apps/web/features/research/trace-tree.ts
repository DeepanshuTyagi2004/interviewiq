import type { ResearchSpan } from "./types";

export interface SpanNode {
  span: ResearchSpan;
  children: SpanNode[];
  /** This span or any descendant failed: drives the error marker on collapsed parents. */
  hasError: boolean;
  depth: number;
}

const byStart = (a: SpanNode, b: SpanNode) => a.span.started_at.localeCompare(b.span.started_at);

/** Flat spans (parent_id links) → a start-ordered tree. Spans whose parent isn't loaded become roots. */
export function buildSpanTree(spans: ResearchSpan[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>(spans.map((s) => [s.span_id, { span: s, children: [], hasError: false, depth: 0 }]));
  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.span.parent_id ? nodes.get(node.span.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const visit = (node: SpanNode, depth: number): boolean => {
    node.depth = depth;
    node.children.sort(byStart);
    let failed = node.span.status === "error";
    for (const child of node.children) if (visit(child, depth + 1)) failed = true;
    node.hasError = failed;
    return failed;
  };
  roots.sort(byStart);
  for (const root of roots) visit(root, 0);
  return roots;
}

export function flattenVisible(roots: SpanNode[], collapsed: ReadonlySet<string>): SpanNode[] {
  const out: SpanNode[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node);
    if (!collapsed.has(node.span.span_id)) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return out;
}

export function countSpans(roots: SpanNode[]): number {
  return flattenVisible(roots, new Set()).length;
}

/** The innermost failed span for a company: the step a failure report should show first. */
export function deepestErrorSpan(roots: SpanNode[], companyId: string): ResearchSpan | null {
  let best: SpanNode | null = null;
  for (const node of flattenVisible(roots, new Set())) {
    if (node.span.status !== "error" || node.span.company_id !== companyId) continue;
    if (best === null || node.depth > best.depth || (node.depth === best.depth && node.span.started_at > best.span.started_at)) best = node;
  }
  return best ? best.span : null;
}

/** A company's node spans in start order (their outputs feed the failure report). */
export function nodeSpansFor(roots: SpanNode[], companyId: string): ResearchSpan[] {
  return flattenVisible(roots, new Set())
    .map((n) => n.span)
    .filter((s) => s.kind === "node" && s.company_id === companyId)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}
