import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { JdDetail } from "@/features/jobs";
import { ProcessTab } from "./ProcessTab";
import { RoundCard } from "./RoundCard";
import { ReadinessMeter, roadmapMeta } from "./RoadmapHeader";

function renderCard(round: Parameters<typeof RoundCard>[0]["round"], index = 0) {
  return render(
    <ol>
      <RoundCard round={round} index={index} jdId="jd-1" />
    </ol>,
  );
}

function jd(partial: Partial<JdDetail> = {}): JdDetail {
  return {
    id: "jd-1",
    company: "meesho",
    companyName: "Meesho",
    role: "software-engineer",
    level: "fresher",
    title: "SDE I — Backend",
    specialization: "backend",
    description: null,
    techStack: [],
    sourceUrl: null,
    yoeMin: null,
    yoeMax: null,
    ctcMinLpa: null,
    ctcMaxLpa: null,
    dataConfidence: "high",
    dataAvailability: "rich",
    interviewProcess: null,
    sources: [],
    ...partial,
  };
}

describe("RoundCard", () => {
  it("links a mapped round to booking with its round type", () => {
    renderCard({ round_number: 2, type: "system-design", format: "Whiteboard · 60 min", difficulty: "hard", dominant_topics: ["Caching"] });
    const link = screen.getByRole("link", { name: /book this round: system design/i });
    expect(link).toHaveAttribute("href", "/interviews?jd=jd-1&round=system-design");
    expect(screen.getByText("R02")).toBeInTheDocument();
    expect(screen.getByText("Whiteboard · 60 min · hard")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: /topics/i })).getByText("Caching")).toBeInTheDocument();
  });

  it("links an unmapped round with just the JD and says why", () => {
    renderCard({ round_number: 1, type: "online-assessment" });
    expect(screen.getByRole("link", { name: /book a round: online assessment/i })).toHaveAttribute("href", "/interviews?jd=jd-1");
    expect(screen.getByText(/not run as a mock/i)).toBeInTheDocument();
  });

  it("never shows locked, cleared or scored states", () => {
    const { container } = renderCard({ round_number: 3, type: "lld", support_count: 4, source_count_total: 8 });
    expect(container.textContent).not.toMatch(/locked|unlocked|cleared|passed|score|✓/i);
    expect(screen.getByText("Reported in 4 of 8 sources")).toBeInTheDocument();
  });
});

describe("ProcessTab", () => {
  it("shows an honest empty state with a booking link when there's no brief", () => {
    render(<ProcessTab jd={jd()} />);
    expect(screen.getByText("No interview data yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a round" })).toHaveAttribute("href", "/interviews?jd=jd-1");
  });

  it("renders one card per round, without a customise control", () => {
    render(
      <ProcessTab
        jd={jd({ interviewProcess: { rounds: [{ round_number: 1, type: "dsa" }, { round_number: 2, type: "behavioural" }] } })}
      />,
    );
    const list = screen.getByRole("list", { name: "Interview rounds" });
    expect(within(list).getAllByRole("heading", { level: 3 })).toHaveLength(2);
    // Timeline nodes: R01, R02 (decorative; the headings carry "Round n").
    expect(within(list).getByText("R01")).toBeInTheDocument();
    expect(within(list).getByText("R02")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /book this round/i })).toHaveLength(2);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("roadmap header", () => {
  it("shows readiness as not started, never a level", () => {
    const { container } = render(<ReadinessMeter />);
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/progressing|nearly ready|interview-ready/i);
    const segments = container.querySelectorAll("[data-seg]");
    expect(segments).toHaveLength(4);
    expect(container.querySelectorAll('[data-seg="on"]')).toHaveLength(0);
  });

  it("builds the meta line from real fields only", () => {
    expect(roadmapMeta(jd({ sources: ["a", "b"] }), "Bengaluru, India")).toBe(
      "Bengaluru, India · Fresher · Backend · Data depth high · 2 sources",
    );
    expect(roadmapMeta(jd({ dataConfidence: null, specialization: null }), null)).toBe("Fresher · No interview data yet");
  });
});
