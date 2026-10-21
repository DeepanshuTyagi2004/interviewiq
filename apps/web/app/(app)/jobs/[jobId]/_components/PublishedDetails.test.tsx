import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JdDetail } from "@/features/jobs";
import type { components } from "@/lib/api-client/generated/schema";
import { PublishedDetails, publishedRange } from "./PublishedDetails";
import { Roadmap } from "./Roadmap";

// These tests exercise published facts and round cards; track actions have their own query lifecycle.
vi.mock("./ProcessFlow", () => ({ ProcessFlow: () => null }));
vi.mock("./RoleActions", () => ({ RoleActions: () => null }));

const hooks = vi.hoisted(() => ({ jd: null as JdDetail | null }));
vi.mock("@/features/jobs", async (original) => ({ ...(await original<typeof import("@/features/jobs")>()), useJd: () => ({ data: hooks.jd, isLoading: false, isError: false }), useJdFit: () => ({ data: undefined, isLoading: false, isError: false, refetch: () => undefined }), useJobCompanies: () => ({ data: [] }) }));

// Candidate API shape: generated DTO, with the exact manual enrichmentBrief round keys.
const published = {
  practiceTemplate: false,
  id: "jd-1", company: "example", companyName: "Example", role: "backend", level: "sde2", title: "Platform engineer", specialization: null,
  description: "Build reliable services", techStack: ["TypeScript"], sourceUrl: null,
  yoeMin: 2, yoeMax: 5, ctcMinLpa: 18, ctcMaxLpa: 26.5, dataConfidence: "high", dataAvailability: "rich",
  companyOverview: { overview: "Company overview from verified sources", culture: "Collaborative teams", benefits: "Learning allowance", sourceUrls: ["https://example.com/about"], verified: true },
  sources: ["https://example.com/about", "https://example.com/interviews", "https://example.com/interviews"],
  interviewProcess: {
    dominant_topics: ["Caching"],
    company_specific_patterns: "Company overview from verified sources\n\nCollaborative teams\n\nLearning allowance",
    rounds: [
      { id: "round-2", round_number: 1, name: "Architecture deep dive", type: "system-design", duration_minutes: 75, difficulty: "hard", topics: ["Caching"], problems: ["Design a cache"], format: "Discuss trade-offs", source_urls: ["https://example.com/interviews"], provenance: "admin_verified" },
      { id: "round-1", round_number: 2, name: "Team discussion", type: "behavioural", duration_minutes: 30, difficulty: "medium", topics: [], problems: [], format: "", source_urls: ["https://example.com/interviews"], provenance: "admin_verified" },
    ],
  },
} satisfies components["schemas"]["JobDescriptionDetail"];

beforeEach(() => { hooks.jd = structuredClone(published); });

describe("published company and role details", () => {
  it("renders verified company facts and role ranges alongside the real ordered rounds", async () => {
    render(<Roadmap jdId="jd-1" />);
    expect(screen.getByText("Company overview from verified sources")).toBeInTheDocument();
    expect(screen.getByText("Collaborative teams")).toBeInTheDocument();
    expect(screen.getByText("Learning allowance")).toBeInTheDocument();
    expect(screen.getByText("2–5 years")).toBeInTheDocument();
    expect(screen.getByText("18–26.5 LPA")).toBeInTheDocument();
    const rounds = within(screen.getByRole("list", { name: "Interview rounds" }));
    expect(rounds.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Round 1: Architecture deep dive", "Round 2: Team discussion"]);
    expect(rounds.getByText("System Design · 75 min · Discuss trade-offs · hard")).toBeInTheDocument();
    expect(rounds.getByRole("link", { name: "Book this round: Architecture deep dive" })).toHaveAttribute("href", "/interviews?jd=jd-1&round=system-design");
    expect(screen.getByText(/Reviewed and published by an InterviewIQ admin/)).toBeInTheDocument();
    expect(screen.queryByText(/Built from interview experiences/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reported in/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 sources/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Company sources"));
    expect(screen.getByRole("link", { name: "https://example.com/about" })).toHaveAttribute("href", "https://example.com/about");
    await userEvent.click(rounds.getAllByText("Round sources")[0]!);
    expect(within(rounds.getAllByText("Round sources")[0]!.closest("details")!).getByRole("link", { name: "https://example.com/interviews" })).toBeVisible();
    await userEvent.click(screen.getByText("Practice questions"));
    expect(screen.getByText("Design a cache")).toBeVisible();
  });

  it("keeps manual topics descriptive and does not duplicate company facts as patterns", async () => {
    render(<Roadmap jdId="jd-1" />);
    await userEvent.click(screen.getByRole("tab", { name: "Insights" }));
    expect(screen.getByRole("heading", { name: "Interview topics" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Most-asked topics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Company patterns" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Company overview from verified sources")).toHaveLength(1);
    expect(screen.getByText("Build reliable services")).toBeInTheDocument();
  });

  it("hides absent facts and unknown pay, preserving zero and one-sided experience", () => {
    render(<PublishedDetails jd={{ ...published, companyOverview: { ...published.companyOverview, culture: "", benefits: "" }, yoeMin: 0, yoeMax: null, ctcMinLpa: null, ctcMaxLpa: null }} />);
    expect(screen.getByText("From 0 years")).toBeInTheDocument();
    expect(screen.queryByText("Culture")).not.toBeInTheDocument();
    expect(screen.queryByText("Benefits")).not.toBeInTheDocument();
    expect(screen.queryByText(/Annual CTC/)).not.toBeInTheDocument();
  });

  it("adds no invented details to legacy JDs", () => {
    const { container } = render(<PublishedDetails jd={{ ...published, companyOverview: undefined, yoeMin: null, yoeMax: null, ctcMinLpa: null, ctcMaxLpa: null }} />);
    expect(container).toBeEmptyDOMElement();
    expect(publishedRange(null, 4, "years")).toBe("Up to 4 years");
    expect(publishedRange(3, 3, "years")).toBe("3 years");
    expect(publishedRange(null, null, "LPA")).toBeNull();
  });

  it("never shows template pay, and labels template experience as typical for the level", () => {
    render(<PublishedDetails jd={{ ...published, practiceTemplate: true }} />);
    expect(screen.queryByText("Annual CTC · ₹ lakh")).not.toBeInTheDocument();
    expect(screen.queryByText("Experience")).not.toBeInTheDocument();
    expect(screen.getByText("Experience · typical for level")).toBeInTheDocument();
    expect(screen.getByText("2–5 years")).toBeInTheDocument();
    expect(screen.getByText("Company overview from verified sources")).toBeInTheDocument();
  });
});
