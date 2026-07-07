import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepDetailDrawer } from "./StepDetailDrawer";
import type { AgentStep } from "@/features/agent-diagnostics";

function makeStep(detail: AgentStep["detail"]): AgentStep {
  return {
    name: "route",
    status: "ok",
    llm_label: "iv-route",
    started_at: null,
    finished_at: null,
    duration_ms: 42,
    detail,
  };
}

describe("StepDetailDrawer", () => {
  it("renders nothing when step is null/undefined", () => {
    const { container: c1 } = render(<StepDetailDrawer step={null} onClose={() => {}} />);
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(<StepDetailDrawer step={undefined} onClose={() => {}} />);
    expect(c2).toBeEmptyDOMElement();
  });

  it("is null-safe when detail is empty — renders the step header without crashing", () => {
    render(<StepDetailDrawer step={makeStep({})} onClose={() => {}} />);
    expect(screen.getByText("route")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();
    expect(screen.queryByText("System prompt")).not.toBeInTheDocument();
  });

  it("renders mono blocks for prompt_system, prompt_user, raw_response and thought", () => {
    render(
      <StepDetailDrawer
        step={makeStep({
          prompt_system: "you are an interviewer",
          prompt_user: "candidate said X",
          raw_response: '{"decision":"MOVE_ON"}',
          thought: "the answer covered the key tradeoffs, moving on",
        })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("System prompt")).toBeInTheDocument();
    expect(screen.getByText("you are an interviewer")).toBeInTheDocument();
    expect(screen.getByText("User prompt")).toBeInTheDocument();
    expect(screen.getByText("candidate said X")).toBeInTheDocument();
    expect(screen.getByText("Raw response")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("the answer covered the key tradeoffs, moving on")).toBeInTheDocument();
  });

  it("renders JSON for inputs, decision and parsed_output", () => {
    render(
      <StepDetailDrawer
        step={makeStep({
          inputs: { candidate_text: "hi" },
          decision: "MOVE_ON",
          parsed_output: { ok: true },
        })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Inputs")).toBeInTheDocument();
    expect(screen.getByText(/"candidate_text": "hi"/)).toBeInTheDocument();
    expect(screen.getByText("Decision")).toBeInTheDocument();
    expect(screen.getByText(/"MOVE_ON"/)).toBeInTheDocument();
    expect(screen.getByText("Parsed output")).toBeInTheDocument();
  });

  it("shows branch_reason and duration_ms", () => {
    render(
      <StepDetailDrawer
        step={makeStep({ branch_reason: "answer adequate -> move on" })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/answer adequate -> move on/)).toBeInTheDocument();
    expect(screen.getByText(/42ms/)).toBeInTheDocument();
  });

  it("calls onClose when the close control is clicked", async () => {
    const onClose = vi.fn();
    render(<StepDetailDrawer step={makeStep({})} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
