import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { JdFitBreakdown, JdFitPart } from "@/features/jobs";
import { MatchTab, partSummary } from "./MatchTab";

const part = (p: Partial<JdFitPart> & Pick<JdFitPart, "key">): JdFitPart => ({
  weight: 10, value: 0, status: "scored", evidence: [], uncovered: [], hint: null, reason: null, ...p,
});

const breakdown: JdFitBreakdown = {
  jdId: "jd-1", score: 64, levelGap: "none", cap: null, levelFactor: null, userLevel: "fresher", jdLevel: "sde1", configVersion: "jd-fit-v1",
  parts: [
    part({ key: "skills", weight: 30, value: 0.5, evidence: [{ source: "resume", item: "UPI split-pay service", matched: "spring boot", tag: "Spring Boot" }], uncovered: ["Kafka"] }),
    part({ key: "domain", weight: 10, value: 0.6, evidence: [{ source: "resume", item: "UPI split-pay service", matched: "upi", tag: "fintech" }] }),
    part({ key: "role", weight: 15, status: "dropped", reason: "This role has no specialization." }),
    part({ key: "experience", weight: 20, value: 1, evidence: [{ source: "resume", item: "Full-time experience", matched: "0 yrs", tag: "0–2 yrs asked" }] }),
    part({ key: "round_topics", weight: 25, status: "missing", hint: "Connect LeetCode, Codeforces or TUF to show coverage of Graphs.", uncovered: ["Graphs"] }),
  ],
};

describe("MatchTab", () => {
  it("explains every part: evidence for scored, the hint for missing, the reason for dropped", () => {
    render(<MatchTab fit={breakdown} isLoading={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 in this role's stack")).toBeInTheDocument();
    expect(screen.getByText(/✓ Spring Boot · UPI split-pay service/)).toBeInTheDocument();
    expect(screen.getByText(/✗ Kafka/)).toBeInTheDocument();
    expect(screen.getByText(/"upi" in UPI split-pay service/)).toBeInTheDocument();
    expect(screen.getByText("This role has no specialization.")).toBeInTheDocument();
    expect(screen.getByText("not scored")).toBeInTheDocument();
    expect(screen.getByText(/Connect LeetCode, Codeforces or TUF/)).toBeInTheDocument();
    expect(screen.getByText(/not a hiring decision/)).toBeInTheDocument();
    expect(screen.queryByText(/eligib|qualif|shortlist/i)).not.toBeInTheDocument();
  });

  it("says when a stretch role is capped", () => {
    render(<MatchTab fit={{ ...breakdown, score: 40, levelGap: "stretch", cap: 40, jdLevel: "sde3" }} isLoading={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByText(/Stretch role/)).toBeInTheDocument();
    expect(screen.getByText(/capped at 40%/)).toBeInTheDocument();
  });

  it("explains the level-gap factor on roles below the user's level", () => {
    const view = render(<MatchTab fit={{ ...breakdown, score: 54, levelGap: "none", levelFactor: 0.85, userLevel: "sde2", jdLevel: "sde1" }} isLoading={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByText(/One level below your level · scored ×0\.85 for the level gap/)).toBeInTheDocument();
    view.rerender(<MatchTab fit={{ ...breakdown, score: 45, levelGap: "below", levelFactor: 0.7, userLevel: "sde3", jdLevel: "fresher" }} isLoading={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByText(/Below your level · scored ×0\.7 for the level gap/)).toBeInTheDocument();
  });

  it("shows an empty state when the JD has nothing to match, and a retry on failure", () => {
    const view = render(<MatchTab fit={{ ...breakdown, score: null }} isLoading={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByText("No match score yet")).toBeInTheDocument();
    const retry = vi.fn();
    view.rerender(<MatchTab fit={undefined} isLoading={false} isError onRetry={retry} />);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalled();
  });

  it("summarises experience as years against the range asked", () => {
    expect(partSummary(breakdown.parts[3]!)).toBe("0 yrs full-time vs 0–2 yrs asked");
  });
});
