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
