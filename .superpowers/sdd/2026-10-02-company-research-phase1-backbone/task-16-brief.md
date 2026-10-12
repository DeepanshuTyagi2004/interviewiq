## Task 16: Runs debugger and page wiring

**Files:**
- Create in `apps/web/app/(app)/intelligence/_components/research/`: `RunsTab.tsx`, `RunControlBar.tsx`, `BudgetMeters.tsx`, `TraceTree.tsx`, `GraphMiniMap.tsx`, `GraphMiniMapInner.tsx`, `SpanDetail.tsx`, `PayloadViewer.tsx`, `LiveConsole.tsx`
- Modify: `apps/web/app/(app)/intelligence/page.tsx`, `apps/web/features/intelligence/{api,hooks,index,types}.ts`, `apps/web/lib/constants/intelligence/index.ts`
- Delete: `apps/web/app/(app)/intelligence/_components/CompaniesPanel.tsx`, `apps/web/app/(app)/intelligence/_components/RemoveCompanyButton.tsx`
- Test, in the same folder: `RunControlBar.test.tsx`, `TraceTree.test.tsx`, `LiveConsole.test.tsx`, `SpanDetail.test.tsx`

**Interfaces:**
- Consumes: `@/features/research` (Task 14).
- Produces:
  - `RunsTab` (no props).
  - `RunControlBar({runs, run, items, onSelectRun})`.
  - `BudgetMeters({run})`.
  - `TraceTree({roots, items, selectedSpanId, onSelectSpan, onCopyFailure})`.
  - `GraphMiniMap({item})`.
  - `SpanDetail({spanId, run, companyName})`.
  - `PayloadViewer({value, language?, height?})`.
  - `LiveConsole({events, items, live, onSelectSpan, canLoadOlder, onLoadOlder, loadingOlder})`.
  - The page is URL-driven: `?tab=&run=&company=&span=`.

- [ ] **Step 1: Write the failing component tests**

`RunControlBar.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeItem, makeRun } from "@/features/research/testing";

const h = vi.hoisted(() => ({ controlMutate: vi.fn(), startMutate: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: class extends Error {}, apiFetch: vi.fn() }));
vi.mock("@/features/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/research")>()),
  useRunControl: () => ({ mutate: h.controlMutate, isPending: false }),
  useStartRun: () => ({ mutate: h.startMutate, isPending: false }),
  useAdminCompanies: () => ({ data: { companies: [], researchAvailable: true } }),
}));

import { RunControlBar } from "./RunControlBar";

const enabled = (name: string) => !(screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

describe("RunControlBar", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["running", { "Start all": false, Pause: true, Resume: false, Stop: true }],
    ["paused", { "Start all": false, Pause: false, Resume: true, Stop: true }],
    ["completed", { "Start all": true, Pause: false, Resume: false, Stop: false }],
  ] as const)("%s run enables exactly the controls that apply", (status, expected) => {
    const run = makeRun({ status });
    render(<RunControlBar runs={[run]} run={run} items={[makeItem()]} onSelectRun={vi.fn()} />);
    for (const [name, on] of Object.entries(expected)) expect(enabled(name)).toBe(on);
  });

  it("pause sends the control for this run", async () => {
    const run = makeRun({ status: "running" });
    render(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(h.controlMutate).toHaveBeenCalledWith({ runId: run.run_id, action: "pause" }, expect.any(Object));
  });

  it("says why a run paused itself", () => {
    const run = makeRun({ status: "paused", pause_reason: "budget_exhausted" });
    render(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={vi.fn()} />);
    expect(screen.getByText(/budget cap reached/i)).toBeInTheDocument();
  });

  it("Start all uses the chosen mode", async () => {
    render(<RunControlBar runs={[]} run={undefined} items={[]} onSelectRun={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Mode"), "replay");
    await userEvent.click(screen.getByRole("button", { name: "Start all" }));
    expect(h.startMutate).toHaveBeenCalledWith({ scope: "all", mode: "replay" }, expect.any(Object));
  });
});
```

`TraceTree.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildSpanTree } from "@/features/research";
import { makeItem, makeSpan } from "@/features/research/testing";

vi.mock("./GraphMiniMap", () => ({ GraphMiniMap: ({ item }: { item: { company_id: string } }) => <div data-testid="minimap">{item.company_id}</div> }));

import { TraceTree } from "./TraceTree";

const t = (s: number) => `2026-10-02T10:00:0${s}+00:00`;
const SPANS = [
  makeSpan({ span_id: "run", kind: "run", name: "run", started_at: t(0) }),
  makeSpan({ span_id: "co", parent_id: "run", kind: "company", name: "Meesho", company_id: "c-meesho", status: "ok", started_at: t(1) }),
  makeSpan({ span_id: "res", parent_id: "co", kind: "node", name: "resolve", company_id: "c-meesho", status: "error", started_at: t(2) }),
];

describe("TraceTree", () => {
  it("shows nested steps with a minimap per company, and selects on click", async () => {
    const onSelect = vi.fn();
    render(<TraceTree roots={buildSpanTree(SPANS)} items={[makeItem()]} selectedSpanId={null} onSelectSpan={onSelect} onCopyFailure={vi.fn()} />);
    expect(screen.getByTestId("minimap")).toHaveTextContent("c-meesho");
    await userEvent.click(screen.getByRole("button", { name: /resolve/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ span_id: "res" }));
  });

  it("marks a collapsed company whose steps failed", async () => {
    render(<TraceTree roots={buildSpanTree(SPANS)} items={[makeItem()]} selectedSpanId={null} onSelectSpan={vi.fn()} onCopyFailure={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse Meesho" }));
    expect(screen.queryByRole("button", { name: /resolve/ })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("a step inside failed").length).toBeGreaterThan(0);
  });

  it("offers a failure report for a failed company", async () => {
    const onCopyFailure = vi.fn();
    const failed = makeItem({ status: "failed" });
    render(<TraceTree roots={buildSpanTree(SPANS)} items={[failed]} selectedSpanId={null} onSelectSpan={vi.fn()} onCopyFailure={onCopyFailure} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy failure report for Meesho" }));
    expect(onCopyFailure).toHaveBeenCalledWith(failed);
  });
});
```

`LiveConsole.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeEvent, makeItem } from "@/features/research/testing";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: class extends Error {}, apiFetch: vi.fn() }));

import { LiveConsole } from "./LiveConsole";

const EVENTS = [
  makeEvent({ seq: 1, level: "debug", level_rank: 10, type: "span.start", message: "node · resolve", span_id: "s1", company_id: "c-meesho", node: "resolve" }),
  makeEvent({ seq: 2, level: "warn", level_rank: 30, message: "Meesho evidence dropped", company_id: "c-meesho", node: "resolve" }),
];

function renderConsole(onSelectSpan = vi.fn()) {
  render(<LiveConsole events={EVENTS} items={[makeItem()]} live onSelectSpan={onSelectSpan} canLoadOlder={false} onLoadOlder={vi.fn()} loadingOlder={false} />);
  return onSelectSpan;
}

describe("LiveConsole", () => {
  it("filters by minimum level and by text", async () => {
    renderConsole();
    expect(screen.getByText("node · resolve")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Minimum level"), "warn");
    expect(screen.queryByText("node · resolve")).not.toBeInTheDocument();
    expect(screen.getByText("Meesho evidence dropped")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Minimum level"), "trace");
    await userEvent.type(screen.getByLabelText("Search messages"), "evidence");
    expect(screen.queryByText("node · resolve")).not.toBeInTheDocument();
  });

  it("clicking a line that belongs to a step selects that step", async () => {
    const onSelectSpan = renderConsole();
    await userEvent.click(screen.getByText("node · resolve"));
    expect(onSelectSpan).toHaveBeenCalledWith("s1", "c-meesho");
  });

  it("copies only the visible lines", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderConsole();
    await userEvent.selectOptions(screen.getByLabelText("Minimum level"), "warn");
    await userEvent.click(screen.getByRole("button", { name: "Copy visible" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain("Meesho evidence dropped");
    expect(writeText.mock.calls[0]![0]).not.toContain("node · resolve");
  });
});
```

`SpanDetail.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeEvent, makeRun, makeSpan } from "@/features/research/testing";

const h = vi.hoisted(() => ({ detail: { data: undefined as unknown, isLoading: false, isError: false, error: null } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: class extends Error {}, apiFetch: vi.fn() }));
vi.mock("./PayloadViewer", () => ({ PayloadViewer: ({ value }: { value: unknown }) => <pre data-testid="payload">{typeof value === "string" ? value : JSON.stringify(value)}</pre> }));
vi.mock("@/features/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/research")>()),
  useSpanDetail: () => h.detail,
}));

import { SpanDetail } from "./SpanDetail";

const LLM_SPAN = {
  ...makeSpan({
    span_id: "s".repeat(32), kind: "llm", name: "resolve_company@v1", node: "resolve", company_id: "c-meesho", status: "error",
    attrs: { model: "gemma-3-27b-it", prompt_name: "resolve_company", prompt_version: "v1", tokens_in: 900 },
    error: { type: "ValidationError", message: "canonical_name missing", traceback: "Traceback (most recent call last)…", code_ref: "app/research/nodes/resolve.py:resolve" },
  }),
  input: { system: "SYSTEM PROMPT", user: "Company name as entered: Meesho" },
  output: { data: { is_company: true }, content: "{\"is_company\": true}" },
};

describe("SpanDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.detail = { data: { span: LLM_SPAN, logs: [makeEvent({ seq: 4, message: "resolve meesho: 5 results" })] }, isLoading: false, isError: false, error: null };
  });

  it("asks to pick a step when none is selected", () => {
    render(<SpanDetail spanId={null} run={makeRun()} companyName={null} />);
    expect(screen.getByText("Pick a step")).toBeInTheDocument();
  });

  it("opens a failed step on its error, with the code location", () => {
    render(<SpanDetail spanId={LLM_SPAN.span_id} run={makeRun()} companyName="Meesho" />);
    expect(screen.getByRole("tab", { name: "Error" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("payload")).toHaveTextContent("ValidationError: canonical_name missing");
    expect(screen.getByRole("button", { name: /app\/research\/nodes\/resolve\.py:resolve/ })).toBeInTheDocument();
  });

  it("shows the full prompt and the raw reply for LLM steps", async () => {
    render(<SpanDetail spanId={LLM_SPAN.span_id} run={makeRun()} companyName="Meesho" />);
    await userEvent.click(screen.getByRole("tab", { name: "Prompt" }));
    expect(screen.getByTestId("payload")).toHaveTextContent("SYSTEM PROMPT");
    expect(screen.getByTestId("payload")).toHaveTextContent("Company name as entered: Meesho");
    await userEvent.click(screen.getByRole("tab", { name: "Reply" }));
    expect(screen.getByTestId("payload")).toHaveTextContent('{"is_company": true}');
  });

  it("Copy for Claude puts a context-first markdown bundle on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SpanDetail spanId={LLM_SPAN.span_id} run={makeRun()} companyName="Meesho" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy for Claude" }));
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("## InterviewIQ research trace — llm · resolve_company@v1 · error");
    expect(text).toContain("- code: apps/ai-service/app/research/nodes/resolve.py:resolve");
    expect(text).toContain("resolve meesho: 5 results");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/web exec vitest run "app/(app)/intelligence/_components/research"`
Expected: FAIL. The components cannot be resolved.

- [ ] **Step 3: Implement the viewer, minimap and tree**

`PayloadViewer.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

// Monaco reads browser-only APIs; never render it during SSR / `next build`.
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div data-motion className="h-[420px] animate-pulse rounded-md bg-panel" />,
});

/** Read-only Monaco for span payloads: folding, search (⌘F), word wrap. Text is the full value. */
export function PayloadViewer({ value, language = "json", height = 420 }: { value: unknown; language?: "json" | "plaintext"; height?: number }) {
  const { resolvedTheme } = useTheme();
  const text = language === "plaintext" && typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return (
    <div className="overflow-hidden rounded-md border border-line-2">
      <Editor
        height={height}
        language={language}
        value={text}
        theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
        options={{
          readOnly: true, domReadOnly: true, minimap: { enabled: false }, wordWrap: "on", folding: true,
          scrollBeyondLastLine: false, fontSize: 12, renderLineHighlight: "none", automaticLayout: true,
        }}
      />
    </div>
  );
}
```

`GraphMiniMap.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import type { ResearchItem } from "@/features/research";

// react-flow reads layout/ResizeObserver APIs; client-only, like the agent pipeline canvas.
const GraphMiniMapInner = dynamic(() => import("./GraphMiniMapInner"), {
  ssr: false,
  loading: () => <div data-motion className="h-14 animate-pulse rounded-md bg-panel" />,
});

/** The company's LangGraph as a strip of nodes coloured by progress; the running node pulses. */
export function GraphMiniMap({ item }: { item: ResearchItem }) {
  return <GraphMiniMapInner item={item} />;
}
```

`GraphMiniMapInner.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { Position, ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NODE_ORDER } from "@/lib/constants/research";
import { nodeStates, type NodeState, type ResearchItem } from "@/features/research";

const NODE_CLASS: Record<NodeState, string> = {
  idle: "border-dashed border-line-3 bg-card text-faint",
  running: "border-brand bg-card text-foreground ring-2 ring-brand/20 motion-safe:animate-[iq-breathe_1.4s_ease-in-out_infinite]",
  ok: "border-faint-2 bg-card text-foreground",
  error: "border-destructive bg-destructive/10 text-destructive",
};

const EDGES: Edge[] = NODE_ORDER.slice(0, -1).map((name, i) => ({ id: `${name}->${NODE_ORDER[i + 1]}`, source: name, target: NODE_ORDER[i + 1]! }));

export default function GraphMiniMapInner({ item }: { item: ResearchItem }) {
  const nodes = useMemo<Node[]>(
    () =>
      nodeStates(item).map(({ name, state }, i) => ({
        id: name,
        position: { x: i * 160, y: 0 },
        data: { label: name.replace(/_/g, " ") },
        draggable: false,
        selectable: false,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: `!w-auto !rounded-full !border !px-3 !py-1 !font-mono !text-[11px] ${NODE_CLASS[state]}`,
      })),
    [item],
  );
  // Same HUD-zoom inversion as PipelineCanvasInner: React Flow must run at an effective zoom of 1.
  return (
    <div className="h-14">
      <div className="h-full [zoom:calc(1/var(--hud-zoom,1))]">
        <div className="h-full [--xy-attribution-background-color:transparent] [--xy-edge-stroke:hsl(var(--line-4))]">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={EDGES}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnScroll={false}
              panOnDrag={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              fitView
              proOptions={{ hideAttribution: true }}
            />
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  );
}
```

`TraceTree.tsx`:

```tsx
"use client";

import * as React from "react";
import { ChevronRight, ClipboardCopy } from "lucide-react";
import { StatusDot, padCount } from "@/components/hud";
import { CardEmpty, ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { formatDuration } from "@/components/observability/status";
import { cn } from "@/lib/utils/cn";
import { SPAN_STATUS_DOT, countSpans, flattenVisible, type ResearchItem, type ResearchSpan, type SpanNode } from "@/features/research";
import { GraphMiniMap } from "./GraphMiniMap";

const KIND_LABEL: Record<string, string> = {
  run: "RUN", company: "CO", node: "NODE", exa: "EXA", llm: "LLM", cache: "CACHE", merge: "MERGE", normalize: "NORM", db: "DB",
};

/** Left pane of the debugger: run → company → node → step, live status, durations, errors bubbling up. */
export function TraceTree({
  roots,
  items,
  selectedSpanId,
  onSelectSpan,
  onCopyFailure,
}: {
  roots: SpanNode[];
  items: ResearchItem[];
  selectedSpanId: string | null;
  onSelectSpan: (span: ResearchSpan) => void;
  onCopyFailure: (item: ResearchItem) => void;
}) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const rows = React.useMemo(() => flattenVisible(roots, collapsed), [roots, collapsed]);
  const itemsByCompany = React.useMemo(() => new Map(items.map((i) => [i.company_id, i])), [items]);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ConsoleCard title="Trace" meta={<HeaderCount>{padCount(countSpans(roots))} steps</HeaderCount>}>
      {rows.length === 0 ? (
        <CardEmpty title="No steps yet" hint="Steps appear here as the run works." />
      ) : (
        <ul role="tree" aria-label="Run trace" className="m-0 max-h-[560px] list-none overflow-y-auto p-0">
          {rows.map((node) => {
            const s = node.span;
            const expandable = node.children.length > 0;
            const open = !collapsed.has(s.span_id);
            const item = s.kind === "company" && s.company_id ? itemsByCompany.get(s.company_id) : undefined;
            const retries = typeof s.attrs?.retries === "number" ? (s.attrs.retries as number) : 0;
            return (
              <li key={s.span_id} role="treeitem" aria-level={node.depth + 1} aria-expanded={expandable ? open : undefined} aria-selected={s.span_id === selectedSpanId}>
                <div
                  className={cn("flex items-center gap-1 rounded-md pr-2 text-[13px]", s.span_id === selectedSpanId ? "bg-line-2" : "hover:bg-accent")}
                  style={{ paddingLeft: 4 + node.depth * 14 }}
                >
                  {expandable ? (
                    <button
                      type="button"
                      aria-label={`${open ? "Collapse" : "Expand"} ${s.name}`}
                      className="grid h-5 w-5 flex-none place-items-center text-faint"
                      onClick={() => toggle(s.span_id)}
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
                    </button>
                  ) : (
                    <span aria-hidden className="h-5 w-5 flex-none" />
                  )}
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onClick={() => onSelectSpan(s)}>
                    <StatusDot state={SPAN_STATUS_DOT[s.status]} srLabel={s.status} />
                    <span className="w-11 flex-none font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{KIND_LABEL[s.kind] ?? s.kind}</span>
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {node.hasError && s.status !== "error" ? (
                      <span role="img" aria-label="a step inside failed" className="h-1.5 w-1.5 flex-none rounded-full bg-destructive" />
                    ) : null}
                    {retries > 0 ? <span className="font-mono text-[10.5px] text-faint">↻{retries}</span> : null}
                    <span className="flex-none font-mono text-[11px] tabular-nums text-faint">{s.duration_ms != null ? formatDuration(s.duration_ms) : "…"}</span>
                  </button>
                  {item?.status === "failed" ? (
                    <button
                      type="button"
                      aria-label={`Copy failure report for ${s.name}`}
                      title="Copy failure report"
                      className="grid h-6 w-6 flex-none place-items-center text-destructive"
                      onClick={() => onCopyFailure(item)}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                {item && open ? (
                  <div className="pb-1 pr-2" style={{ paddingLeft: 26 + node.depth * 14 }}>
                    <GraphMiniMap item={item} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </ConsoleCard>
  );
}
```

- [ ] **Step 4: Implement the span detail, console, budget and control bar**

`SpanDetail.tsx`:

```tsx
"use client";

import { StatusDot } from "@/components/hud";
import { CardEmpty, ConsoleCard } from "@/components/observability/ConsoleCard";
import { LogTerminal } from "@/components/observability/LogTerminal";
import { formatDuration } from "@/components/observability/status";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiFetchError } from "@/lib/api-client/client";
import { SPAN_STATUS_DOT, copyText, formatSpanForClaude, useSpanDetail, type ResearchRun } from "@/features/research";
import { PayloadViewer } from "./PayloadViewer";

/** Right pane of the debugger: one step's full input, output, logs and raw document. */
export function SpanDetail({ spanId, run, companyName }: { spanId: string | null; run: ResearchRun | undefined; companyName: string | null }) {
  const q = useSpanDetail(spanId);
  if (!spanId) {
    return (
      <ConsoleCard title="Step">
        <CardEmpty title="Pick a step" hint="Select a step in the trace, or a console line, to see its full input, output and logs." />
      </ConsoleCard>
    );
  }
  if (q.isLoading) {
    return (
      <ConsoleCard title="Step">
        <p className="m-0 text-[13px] text-muted-foreground">Loading step…</p>
      </ConsoleCard>
    );
  }
  if (q.isError || !q.data) {
    return (
      <ConsoleCard title="Step">
        <p role="alert" className="m-0 text-[13px] text-destructive">
          Could not load this step: {q.error instanceof ApiFetchError ? q.error.message : "unknown error"}
        </p>
      </ConsoleCard>
    );
  }

  const { span, logs } = q.data;
  const isLlm = span.kind === "llm";
  const input = (span.input ?? null) as Record<string, unknown> | null;
  const output = (span.output ?? null) as Record<string, unknown> | null;
  const scalarAttrs = Object.entries(span.attrs ?? {}).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  const firstTab = span.error ? "error" : isLlm ? "prompt" : "output";

  return (
    <ConsoleCard title={`${span.kind} · ${span.name}`} meta={<StatusDot state={SPAN_STATUS_DOT[span.status]} label={span.status} />}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
          <span>{span.duration_ms != null ? formatDuration(span.duration_ms) : "running…"}</span>
          {scalarAttrs.map(([k, v]) => (
            <span key={k}>
              {k} <span className="text-foreground">{String(v)}</span>
            </span>
          ))}
          {span.error?.code_ref ? (
            <button
              type="button"
              className="underline-offset-4 hover:underline"
              onClick={() => copyText(`apps/ai-service/${span.error!.code_ref}`, "Code location copied")}
            >
              code {span.error.code_ref}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => copyText(formatSpanForClaude({ span, logs, run: run ?? null, companyName }), "Copied for Claude")}>
            Copy for Claude
          </Button>
          <Button size="sm" variant="strong" onClick={() => copyText(JSON.stringify(q.data, null, 2), "Step JSON copied")}>
            Copy JSON
          </Button>
        </div>
        <Tabs key={span.span_id} defaultValue={firstTab}>
          <TabsList className="flex-wrap">
            {span.error ? <TabsTrigger value="error">Error</TabsTrigger> : null}
            {isLlm ? <TabsTrigger value="prompt">Prompt</TabsTrigger> : null}
            {isLlm ? <TabsTrigger value="reply">Reply</TabsTrigger> : null}
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="logs">Logs ({logs.length})</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>
          {span.error ? (
            <TabsContent value="error">
              <PayloadViewer language="plaintext" value={`${span.error.type}: ${span.error.message}\n\n${span.error.traceback ?? ""}`} />
            </TabsContent>
          ) : null}
          {isLlm ? (
            <TabsContent value="prompt">
              <PayloadViewer language="plaintext" value={`${String(input?.system ?? "")}\n\n────── user ──────\n\n${String(input?.user ?? "")}`} />
            </TabsContent>
          ) : null}
          {isLlm ? (
            <TabsContent value="reply">
              <PayloadViewer
                language="plaintext"
                value={typeof output?.content === "string" ? output.content : JSON.stringify(output?.data ?? null, null, 2)}
              />
            </TabsContent>
          ) : null}
          <TabsContent value="input"><PayloadViewer value={span.input ?? null} /></TabsContent>
          <TabsContent value="output"><PayloadViewer value={span.output ?? null} /></TabsContent>
          <TabsContent value="logs"><LogTerminal logs={logs} title="Step logs" className="h-[420px]" /></TabsContent>
          <TabsContent value="raw"><PayloadViewer value={q.data} /></TabsContent>
        </Tabs>
      </div>
    </ConsoleCard>
  );
}
```

`LiveConsole.tsx`:

```tsx
"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { padCount } from "@/components/hud";
import { ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NODE_ORDER } from "@/lib/constants/research";
import { cn } from "@/lib/utils/cn";
import {
  DEFAULT_FILTERS, LEVEL_ORDER, copyText, filterEvents, logLine,
  type EventFilters, type ResearchEvent, type ResearchItem, type ResearchLevel,
} from "@/features/research";

const SELECT = "h-8 rounded-full border border-input bg-card px-3 font-mono text-[12px]";

/** Bottom pane: every trace event, live. Filters, follow-tail, older pages, copy. */
export function LiveConsole({
  events,
  items,
  live,
  onSelectSpan,
  canLoadOlder,
  onLoadOlder,
  loadingOlder,
}: {
  events: ResearchEvent[];
  items: ResearchItem[];
  live: boolean;
  onSelectSpan: (spanId: string, companyId: string | null) => void;
  canLoadOlder: boolean;
  onLoadOlder: () => void;
  loadingOlder: boolean;
}) {
  const [filters, setFilters] = React.useState<EventFilters>(DEFAULT_FILTERS);
  const [follow, setFollow] = React.useState(true);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const shown = React.useMemo(() => filterEvents(events, filters), [events, filters]);
  const companies = React.useMemo(() => new Map(items.map((i) => [i.company_id, i.company_name])), [items]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!atBottom && follow) setFollow(false);
  };
  const set = <K extends keyof EventFilters>(key: K, value: EventFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <ConsoleCard title="Console" meta={<HeaderCount>{padCount(shown.length)} / {padCount(events.length)}{live ? " · live" : ""}</HeaderCount>}>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <select aria-label="Minimum level" className={SELECT} value={filters.minLevel} onChange={(e) => set("minLevel", e.target.value as ResearchLevel)}>
          {LEVEL_ORDER.map((l) => <option key={l} value={l}>{l}+</option>)}
        </select>
        <select aria-label="Company" className={SELECT} value={filters.companyId ?? ""} onChange={(e) => set("companyId", e.target.value || null)}>
          <option value="">All companies</option>
          {[...companies].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Node" className={SELECT} value={filters.node ?? ""} onChange={(e) => set("node", e.target.value || null)}>
          <option value="">All nodes</option>
          {NODE_ORDER.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <Input aria-label="Event type prefix" placeholder="type, e.g. span." value={filters.type} onChange={(e) => set("type", e.target.value)} className="h-8 w-36 rounded-full font-mono text-[12px]" />
        <Input aria-label="Search messages" placeholder="search…" value={filters.q} onChange={(e) => set("q", e.target.value)} className="h-8 w-44 rounded-full text-[12px]" />
        <Button size="sm" variant={follow ? "ink" : "strong"} aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
          {follow ? "Following" : "Follow tail"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!canLoadOlder || loadingOlder} onClick={onLoadOlder}>
          {loadingOlder ? "Loading…" : "Load older"}
        </Button>
        <Button size="sm" variant="ghost" disabled={shown.length === 0} onClick={() => copyText(shown.map(logLine).join("\n"), "Visible lines copied")}>
          Copy visible
        </Button>
      </div>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        role="log"
        aria-label="Research events"
        className="h-[420px] overflow-y-auto rounded-md border border-line-2 bg-panel p-2 font-mono text-[11.5px] leading-[1.55]"
      >
        {shown.length === 0 ? (
          <p className="m-0 p-2 text-faint">{events.length > 0 ? "No events match these filters." : "Waiting for events…"}</p>
        ) : (
          shown.map((e) => (
            <div
              key={e.seq}
              className={cn(
                "group flex gap-2 rounded px-1 hover:bg-accent",
                e.level === "error" && "text-destructive",
                e.level === "warn" && "text-[hsl(var(--color-lc-medium))]",
              )}
            >
              <span className="w-12 flex-none text-right tabular-nums text-faint">{e.seq}</span>
              <span className="w-16 flex-none tabular-nums text-faint">{e.ts.slice(11, 19)}</span>
              <span className="w-10 flex-none uppercase">{e.level}</span>
              <span className="w-24 flex-none truncate text-faint">{e.company_id ? (companies.get(e.company_id) ?? e.company_id.slice(0, 8)) : "—"}</span>
              <span className="w-20 flex-none truncate text-faint">{e.node ?? "—"}</span>
              <span className="w-28 flex-none truncate">{e.type}</span>
              {e.span_id ? (
                <button type="button" title={e.message} className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onSelectSpan(e.span_id!, e.company_id ?? null)}>
                  {e.message}
                </button>
              ) : (
                <span title={e.message} className="min-w-0 flex-1 truncate">{e.message}</span>
              )}
              <button
                type="button"
                aria-label={`Copy event ${e.seq}`}
                className="invisible flex-none text-faint group-focus-within:visible group-hover:visible"
                onClick={() => copyText(JSON.stringify(e, null, 2), "Event copied")}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </ConsoleCard>
  );
}
```

`BudgetMeters.tsx`:

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { HudCard, SegmentMeter } from "@/components/hud";
import { HeaderCount } from "@/components/observability/ConsoleCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiFetchError } from "@/lib/api-client/client";
import { useRaiseBudget, type ResearchRun } from "@/features/research";

function Meter({ label, used, cap }: { label: string; used: number; cap: number }) {
  const ratio = cap > 0 ? used / cap : 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="iq-eyebrow">{label}</span>
        <span className="font-mono text-[12px] tabular-nums">{used} / {cap}</span>
      </div>
      <SegmentMeter segments={20} filled={ratio * 20} tone={ratio >= 1 ? "brand" : "ink"} label={`${label}: ${used} of ${cap} used`} />
    </div>
  );
}

/** Exa / LLM calls used vs cap, plus tokens. Reaching a cap auto-pauses the run; raise it here, then Resume. */
export function BudgetMeters({ run }: { run: ResearchRun }) {
  const raise = useRaiseBudget();
  const b = run.budget;
  const [exaCap, setExaCap] = React.useState(String(b.exa_cap));
  const [llmCap, setLlmCap] = React.useState(String(b.llm_cap));
  React.useEffect(() => {
    setExaCap(String(b.exa_cap));
    setLlmCap(String(b.llm_cap));
  }, [b.exa_cap, b.llm_cap]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    raise.mutate(
      { runId: run.run_id, exaCap: Number(exaCap), llmCap: Number(llmCap) },
      {
        onSuccess: () => toast.success("Budget caps updated"),
        onError: (err) => toast.error(err instanceof ApiFetchError ? err.message : "Could not update the caps"),
      },
    );
  }

  return (
    <HudCard
      title="Budget"
      spotlight={false}
      meta={<HeaderCount>{b.tokens_in.toLocaleString()} in · {b.tokens_out.toLocaleString()} out tokens</HeaderCount>}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Meter label="Exa searches" used={b.exa_used} cap={b.exa_cap} />
        <Meter label="LLM calls" used={b.llm_used} cap={b.llm_cap} />
        <form onSubmit={save} aria-label="Set budget caps" className="flex items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="exa-cap" className="text-[11px]">Exa cap</Label>
            <Input id="exa-cap" type="number" min={b.exa_used} value={exaCap} onChange={(e) => setExaCap(e.target.value)} className="h-8 w-24 font-mono text-[12px]" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="llm-cap" className="text-[11px]">LLM cap</Label>
            <Input id="llm-cap" type="number" min={b.llm_used} value={llmCap} onChange={(e) => setLlmCap(e.target.value)} className="h-8 w-24 font-mono text-[12px]" />
          </div>
          <Button size="sm" variant="strong" type="submit" disabled={raise.isPending}>Set caps</Button>
        </form>
      </div>
    </HudCard>
  );
}
```

`RunControlBar.tsx`:

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { HudCard, StatusDot } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  RUN_STATUS_DOT, collectRunExport, copyText, downloadJson, formatRunSummary, runControls, timeAgo,
  useAdminCompanies, useRunControl, useStartRun,
  type ResearchItem, type ResearchMode, type ResearchRun, type RunAction, type StartResearchRunRequest,
} from "@/features/research";

const MODES: ResearchMode[] = ["live", "record", "replay"];
const SELECT = "h-8 rounded-full border border-input bg-card px-3 font-mono text-[12px]";

function errorMessage(err: unknown): string {
  return err instanceof ApiFetchError ? err.message : "Request failed. Check the API logs.";
}

function runLabel(r: ResearchRun): string {
  const when = r.started_at ?? r.created_at;
  return `${r.run_id.slice(0, 8)} · ${r.status} · ${r.trigger} · ${timeAgo(when)}`;
}

/** Run picker, start (all / selected, by mode), pause / resume / stop, copy summary, export JSON. */
export function RunControlBar({
  runs,
  run,
  items,
  onSelectRun,
}: {
  runs: ResearchRun[];
  run: ResearchRun | undefined;
  items: ResearchItem[];
  onSelectRun: (runId: string) => void;
}) {
  const start = useStartRun();
  const control = useRunControl();
  const [mode, setMode] = React.useState<ResearchMode>("live");
  const controls = runControls(run?.status, start.isPending || control.isPending);
  const options = run && !runs.some((r) => r.run_id === run.run_id) ? [run, ...runs] : runs;

  const startRun = (body: StartResearchRunRequest) =>
    start.mutate(body, { onSuccess: (r) => onSelectRun(r.run_id), onError: (e) => toast.error(errorMessage(e)) });
  const act = (action: RunAction) => {
    if (run) control.mutate({ runId: run.run_id, action }, { onError: (e) => toast.error(errorMessage(e)) });
  };
  async function exportRun() {
    if (!run) return;
    try {
      downloadJson(`research-run-${run.run_id}.json`, await collectRunExport(run.run_id));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <HudCard title="Research run" spotlight={false} meta={run ? <StatusDot state={RUN_STATUS_DOT[run.status]} label={run.status} /> : null}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {options.length > 0 ? (
            <select aria-label="Run" className={`${SELECT} max-w-[340px]`} value={run?.run_id ?? ""} onChange={(e) => onSelectRun(e.target.value)}>
              {options.map((r) => <option key={r.run_id} value={r.run_id}>{runLabel(r)}</option>)}
            </select>
          ) : null}
          <select aria-label="Mode" className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as ResearchMode)}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Button size="sm" disabled={!controls.start} onClick={() => startRun({ scope: "all", mode })}>Start all</Button>
          <StartSelected disabled={!controls.start} onStart={(ids) => startRun({ scope: "selected", companyIds: ids, mode })} />
          <Button size="sm" variant="strong" disabled={!controls.pause} onClick={() => act("pause")}>Pause</Button>
          <Button size="sm" variant="strong" disabled={!controls.resume} onClick={() => act("resume")}>Resume</Button>
          <Button size="sm" variant="ghost" disabled={!controls.stop} onClick={() => act("stop")}>Stop</Button>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" disabled={!run} onClick={() => run && copyText(formatRunSummary(run, items), "Run summary copied")}>
              Copy run summary
            </Button>
            <Button size="sm" variant="ghost" disabled={!run} onClick={exportRun}>Export run JSON</Button>
          </div>
        </div>
        {run ? <RunFacts run={run} /> : null}
      </div>
    </HudCard>
  );
}

function RunFacts({ run }: { run: ResearchRun }) {
  const c = run.counters;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
      <span>mode {run.mode}</span>
      <span>trigger {run.trigger}</span>
      <span>scope {run.scope}</span>
      <span>
        {c.total} total · {c.done} done · {c.skipped} skipped · {c.failed} failed · {c.running} running · {c.paused} paused · {c.queued} queued · {c.cancelled} cancelled
      </span>
      {run.started_at ? <span>started {timeAgo(run.started_at)}</span> : null}
      {run.pause_reason === "budget_exhausted" ? <span className="text-destructive">paused: budget cap reached. Raise a cap, then Resume</span> : null}
      {run.error ? <span className="text-destructive">error: {run.error}</span> : null}
    </div>
  );
}

function StartSelected({ disabled, onStart }: { disabled: boolean; onStart: (ids: string[]) => void }) {
  const companies = useAdminCompanies();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const active = (companies.data?.companies ?? []).filter((c) => c.status === "active");
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="strong" disabled={disabled}>Start selected…</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <fieldset className="m-0 flex max-h-64 flex-col gap-1.5 overflow-y-auto border-0 p-0">
          <legend className="iq-eyebrow mb-2">Companies to research</legend>
          {active.length === 0 ? <p className="m-0 text-[13px] text-muted-foreground">No active companies. Add one on the Companies tab.</p> : null}
          {active.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              {c.name}
            </label>
          ))}
        </fieldset>
        <Button
          size="sm"
          className="mt-3 w-full"
          disabled={picked.size === 0}
          onClick={() => {
            onStart([...picked]);
            setOpen(false);
            setPicked(new Set());
          }}
        >
          Start {picked.size > 0 ? picked.size : ""} selected
        </Button>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Implement RunsTab**

`RunsTab.tsx`:

```tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { HudEmpty } from "@/components/hud";
import {
  buildSpanTree, copyText, deepLinkHref, deepestErrorSpan, formatFailureReport, getSpan, isRunActive, nodeSpansFor,
  parseDeepLink, useResearchRun, useResearchRuns, useRunEvents, useRunSpans,
  type ResearchItem, type ResearchSpan,
} from "@/features/research";
import { BudgetMeters } from "./BudgetMeters";
import { LiveConsole } from "./LiveConsole";
import { RunControlBar } from "./RunControlBar";
import { SpanDetail } from "./SpanDetail";
import { TraceTree } from "./TraceTree";

/** Intelligence → Runs: the research debugger (spec §9.1). Every selection lives in the URL. */
export function RunsTab() {
  const params = useSearchParams();
  const router = useRouter();
  const link = parseDeepLink(params);
  const runs = useResearchRuns();
  const runId = link.run ?? runs.data?.runs[0]?.run_id ?? null;
  const detail = useResearchRun(runId);
  const run = detail.data?.run;
  const items = React.useMemo(() => detail.data?.items ?? [], [detail.data]);
  const live = run ? isRunActive(run.status) : false;
  const spans = useRunSpans(runId, live);
  const roots = React.useMemo(() => buildSpanTree(spans.data?.spans ?? []), [spans.data]);
  const events = useRunEvents(runId, { live, lastSeq: run?.last_seq });

  const navigate = (patch: { run?: string | null; company?: string | null; span?: string | null }) =>
    router.replace(deepLinkHref(new URLSearchParams(params.toString()), { tab: "runs", ...patch }), { scroll: false });
  const selectSpan = (span: Pick<ResearchSpan, "span_id" | "company_id">) => navigate({ span: span.span_id, company: span.company_id });

  async function copyFailure(item: ResearchItem) {
    if (!run) return;
    try {
      const failingSpan = deepestErrorSpan(roots, item.company_id);
      const failing = failingSpan ? (await getSpan(failingSpan.span_id)).span : null;
      const okNodes = nodeSpansFor(roots, item.company_id).filter((s) => s.status === "ok");
      const previousOutputs = await Promise.all(
        okNodes.map(async (s) => ({ node: s.name, output: (await getSpan(s.span_id)).span.output ?? null })),
      );
      const logs = events.events.filter((e) => e.company_id === item.company_id).slice(-200);
      await copyText(formatFailureReport({ run, item, failing, previousOutputs, logs }), "Failure report copied");
    } catch {
      toast.error("Could not build the failure report");
    }
  }

  if (!runId) {
    return (
      <div className="flex flex-col gap-4">
        <RunControlBar runs={[]} run={undefined} items={[]} onSelectRun={(id) => navigate({ run: id, company: null, span: null })} />
        <HudEmpty title="No research runs yet" hint="Start one above, or use Research now on the Companies tab." />
      </div>
    );
  }

  const companyName = link.company ? (items.find((i) => i.company_id === link.company)?.company_name ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <RunControlBar runs={runs.data?.runs ?? []} run={run} items={items} onSelectRun={(id) => navigate({ run: id, company: null, span: null })} />
      {run ? <BudgetMeters run={run} /> : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <TraceTree roots={roots} items={items} selectedSpanId={link.span} onSelectSpan={selectSpan} onCopyFailure={copyFailure} />
        <SpanDetail spanId={link.span} run={run} companyName={companyName} />
      </div>
      <LiveConsole
        events={events.events}
        items={items}
        live={live}
        onSelectSpan={(spanId, companyId) => navigate({ span: spanId, company: companyId })}
        canLoadOlder={events.canLoadOlder}
        onLoadOlder={events.loadOlder}
        loadingOlder={events.loadingOlder}
      />
    </div>
  );
}
```

- [ ] **Step 6: Wire the page and remove the superseded company UI**

Before deleting, run `git diff --stat -- "apps/web/app/(app)/intelligence/_components/CompaniesPanel.tsx" "apps/web/app/(app)/intelligence/_components/RemoveCompanyButton.tsx"`. These files carry uncommitted HUD-restyle edits from another session. The Companies tab supersedes them, so deleting them is intended. Delete both files.

Replace `apps/web/app/(app)/intelligence/page.tsx` with:

```tsx
"use client";

import { Suspense, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { deepLinkHref, parseDeepLink, type IntelligenceTab } from "@/features/research";
import { LiveIngestionPanel } from "./_components/LiveIngestionPanel";
import { AccessControlPanel } from "./_components/AccessControlPanel";
import { QuestionBankPanel } from "./_components/QuestionBankPanel";
import { ResumeBenchPanel } from "./_components/ResumeBenchPanel";
import { InterviewPrepBenchPanel } from "./_components/InterviewPrepBenchPanel";
import { AgentDiagnosticsPanel } from "./_components/AgentDiagnosticsPanel";
import { CompaniesTab } from "./_components/research/CompaniesTab";
import { RunsTab } from "./_components/research/RunsTab";

const TABS: ReadonlyArray<{ value: IntelligenceTab; label: string; Panel: () => ReactNode }> = [
  { value: "companies", label: "Companies", Panel: CompaniesTab },
  { value: "runs", label: "Runs", Panel: RunsTab },
  { value: "briefs", label: "Briefs (legacy)", Panel: LiveIngestionPanel },
  { value: "access", label: "Access", Panel: AccessControlPanel },
  { value: "questions", label: "Question bank", Panel: QuestionBankPanel },
  { value: "resume", label: "Resume bench", Panel: ResumeBenchPanel },
  { value: "prep", label: "Interview prep", Panel: InterviewPrepBenchPanel },
  { value: "agent", label: "Agent diagnostics", Panel: AgentDiagnosticsPanel },
];

export default function IntelligencePage() {
  return (
    <RequireAdmin>
      {/* The tabs read ?tab=&run=&span= via useSearchParams, which needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <IntelligenceTabs />
      </Suspense>
    </RequireAdmin>
  );
}

function IntelligenceTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const { tab } = parseDeepLink(params);
  const onTab = (value: string) =>
    router.replace(deepLinkHref(new URLSearchParams(params.toString()), { tab: value as IntelligenceTab }), { scroll: false });

  return (
    <div className={PAGE_SCAFFOLD}>
      <div className="min-w-0">
        <p className="iq-eyebrow m-0">Admin</p>
        <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">Interview Intelligence</h1>
        <p className="m-0 mt-1.5 max-w-2xl text-[14px] leading-[1.5] text-muted-foreground">
          Curate the companies we research, run and debug the research pipeline step by step, test the resume, prep and
          agent pipelines, and manage who has admin access.
        </p>
      </div>

      <Tabs value={tab} onValueChange={onTab} className="mt-5">
        <div className="sticky top-0 z-20 -mx-4 bg-card px-4 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
          <TabsList
            aria-label="Intelligence sections"
            className="-mx-4 flex h-auto w-auto justify-start gap-6 overflow-x-auto rounded-none bg-transparent p-0 px-4 text-faint shadow-[inset_0_-1px_0_hsl(var(--line-2))] sm:mx-0 sm:px-0"
          >
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="shrink-0 rounded-none border-b-[1.5px] border-transparent px-0 pb-3 pt-3.5 text-sm font-normal text-faint transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {TABS.map(({ value, Panel }) => (
          <TabsContent key={value} value={value} className="mt-6 rounded-[14px] focus-visible:ring-1 focus-visible:ring-offset-4">
            <Panel />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

Keep the existing page's tab-bar class strings exactly as they are in the working tree if they differ from the above (the HUD session may have restyled them). Only the `TABS` list, the URL-driven `value`/`onValueChange` and the Suspense wrapper are this task's changes.

Clean up the old company plumbing:
- In `features/intelligence/api.ts`, delete `listCompanies`, `createCompany`, `deleteCompany` and `seedCompanies`, plus their type imports.
- In `features/intelligence/hooks.ts`, delete `useCompanies`, `useAddCompany`, `useDeleteCompany` and `useSeedCompanies`.
- In `features/intelligence/types.ts`, delete `CompanyWithJds` and `CreateCompanyInput`, plus any type used only by them.
- In `features/intelligence/index.ts`, drop the matching exports.
- In `lib/constants/intelligence/index.ts`, delete `ADMIN_COMPANY_ENDPOINTS` and `INTELLIGENCE_QUERY_KEYS.companies`.

Then run `grep -rn -E "CompaniesPanel|RemoveCompanyButton|useCompanies|useAddCompany|ADMIN_COMPANY_ENDPOINTS|CompanyWithJds" apps/web --include=*.ts --include=*.tsx`. Expected: no matches.

- [ ] **Step 7: Run all web checks**

Run: `pnpm --filter @interviewiq/web typecheck && pnpm --filter @interviewiq/web lint && pnpm --filter @interviewiq/web test`
Expected: PASS. The lint step allows only the pre-existing warnings.

- [ ] **Step 8: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

