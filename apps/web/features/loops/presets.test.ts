import { describe, expect, it } from "vitest";
import { MOCK_ROUND_MINUTES, ROUND_MINUTES_LABEL } from "@/lib/constants/interview";
import { filterNodePresets, NODE_CATEGORIES, NODE_PRESETS, ROUND_PRESETS } from "./presets";

describe("node preset catalogue", () => {
  it("stores the 45-minute maximum on presets and shows a not-yet-booked round as 30-45 min", () => {
    expect(MOCK_ROUND_MINUTES).toBe(45);
    expect(ROUND_MINUTES_LABEL).toBe("30-45 min");
  });

  it("covers specialist roles with more than 80 runnable and 10 reference steps", () => {
    expect(ROUND_PRESETS.length).toBeGreaterThan(80);
    expect(NODE_PRESETS.filter((preset) => preset.kind === "info").length).toBeGreaterThanOrEqual(10);
    expect(NODE_CATEGORIES.length).toBeGreaterThanOrEqual(14);
    expect(new Set(NODE_CATEGORIES.map((category) => category.id)).size).toBe(NODE_CATEGORIES.length);
    expect(new Set(NODE_PRESETS.map((preset) => preset.id)).size).toBe(NODE_PRESETS.length);
    expect(new Set(NODE_PRESETS.map((preset) => preset.label)).size).toBe(NODE_PRESETS.length);
    for (const category of NODE_CATEGORIES) {
      expect(category.label.trim()).not.toBe("");
      expect(category.description.trim()).not.toBe("");
      expect(NODE_PRESETS.some((preset) => preset.category === category.id)).toBe(true);
    }
    for (const preset of NODE_PRESETS) {
      expect(NODE_CATEGORIES.some((category) => category.id === preset.category)).toBe(true);
      expect(preset.label.length).toBeLessThanOrEqual(120);
      expect(preset.label.trim()).not.toBe("");
      expect(preset.description.trim()).not.toBe("");
      expect(preset.instructions.length).toBeLessThanOrEqual(4000);
      expect(preset.instructions.trim()).not.toBe("");
      expect(["easy", "medium", "hard"]).toContain(preset.difficulty);
      expect(preset.topics.length).toBeGreaterThan(0);
      expect(preset.topics.length).toBeLessThanOrEqual(20);
      for (const topic of preset.topics) {
        expect(topic.trim()).not.toBe("");
        expect(topic.length).toBeLessThanOrEqual(80);
      }
      if (preset.kind === "round") {
        expect(["dsa", "system-design", "lld", "behavioural", "hiring-manager"]).toContain(preset.type);
        // Presets store the 45 maximum; the real length is drawn per session at booking.
        expect(preset.durationMinutes).toBe(MOCK_ROUND_MINUTES);
      } else {
        expect(preset.note.length).toBeLessThanOrEqual(1000);
        expect(preset.note.trim()).not.toBe("");
        expect(preset).not.toHaveProperty("type");
        expect(preset).not.toHaveProperty("durationMinutes");
        expect(preset.instructions).toMatch(/non-runnable/);
      }
    }
    expect(ROUND_PRESETS).toEqual(NODE_PRESETS.filter((preset) => preset.kind === "round"));
  });

  it("preserves all fourteen original IDs, labels and difficulty defaults in order, all with the one mock-round length", () => {
    const expected = [
      ["coding", "Coding & algorithms", "dsa", MOCK_ROUND_MINUTES, "medium", ["Arrays", "Trees", "Dynamic programming"]],
      ["architecture", "System architecture", "system-design", MOCK_ROUND_MINUTES, "hard", ["Scalability", "Storage", "Trade-offs"]],
      ["object-design", "Object-oriented design", "lld", MOCK_ROUND_MINUTES, "medium", ["Object-oriented design", "Extensibility"]],
      ["behavioural", "Behavioural & ownership", "behavioural", MOCK_ROUND_MINUTES, "medium", ["Ownership", "Collaboration"]],
      ["project", "Project deep-dive", "hiring-manager", MOCK_ROUND_MINUTES, "medium", ["Project deep-dive", "Technical decisions"]],
      ["frontend", "Frontend system design", "system-design", MOCK_ROUND_MINUTES, "medium", ["Component architecture", "State management", "Accessibility"]],
      ["browser", "Browser & JavaScript", "lld", MOCK_ROUND_MINUTES, "medium", ["Event loop", "DOM", "Rendering performance"]],
      ["backend-api", "Backend & API design", "system-design", MOCK_ROUND_MINUTES, "medium", ["API contracts", "Authentication", "Reliability"]],
      ["sql-data", "SQL & data modelling", "dsa", MOCK_ROUND_MINUTES, "medium", ["SQL", "Joins", "Indexes", "Data modelling"]],
      ["ml-ai", "ML & AI systems", "system-design", MOCK_ROUND_MINUTES, "hard", ["Model evaluation", "Inference", "Data pipelines"]],
      ["debugging", "Debugging & troubleshooting", "lld", MOCK_ROUND_MINUTES, "medium", ["Root cause analysis", "Observability", "Regression diagnosis"]],
      ["devops", "DevOps & cloud", "system-design", MOCK_ROUND_MINUTES, "medium", ["CI/CD", "Cloud infrastructure", "Incident response"]],
      ["machine-coding", "Machine coding", "lld", MOCK_ROUND_MINUTES, "hard", ["Implementation", "Testing", "Maintainability"]],
      ["leadership", "Technical leadership", "hiring-manager", MOCK_ROUND_MINUTES, "hard", ["Mentoring", "Roadmap prioritisation", "Stakeholder alignment"]],
    ];
    expect(ROUND_PRESETS.slice(0, 14).map((preset) => [
      preset.id, preset.label, preset.type, preset.durationMinutes, preset.difficulty, preset.topics,
    ])).toEqual(expected);
    expect(ROUND_PRESETS.find((preset) => preset.id === "sql-data")?.instructions)
      .toBe("Focus on data reasoning, query correctness and trade-offs.");
  });
});

describe("filterNodePresets", () => {
  const ids = (query: string, category = "all") => filterNodePresets(query, category).map((preset) => preset.id);

  it("returns a fresh full list for empty, whitespace or punctuation-only queries", () => {
    expect(filterNodePresets("")).toEqual(NODE_PRESETS);
    expect(filterNodePresets(" \n\t ")).toEqual(NODE_PRESETS);
    expect(filterNodePresets(" / & ")).toEqual(NODE_PRESETS);
    const result = filterNodePresets("");
    result.pop();
    expect(filterNodePresets("")).toHaveLength(NODE_PRESETS.length);
  });

  it("matches case-insensitively and intersects all whitespace-separated tokens", () => {
    expect(ids("  ReAcT\n COMPONENT \t")).toEqual(["react"]);
    expect(ids("retrieval vector")).toContain("rag");
    expect(ids("vector retrieval")).toEqual(ids("retrieval vector"));
    expect(ids("react nonexistenttoken")).toEqual([]);
  });

  it("searches descriptions, topics, keywords and category labels", () => {
    expect(ids("overselling")).toEqual(["database-transactions"]);
    expect(ids("Watermarks")).toEqual(["streaming-data"]);
    expect(ids("golang")).toEqual(["go"]);
    expect(ids("privacy")).toContain("threat-modelling");
    expect(ids("evidence from this exercise")).toEqual([]);
  });

  it("normalises punctuation and supports common aliases", () => {
    expect(ids("AI/ML")).toContain("rag");
    expect(ids("ai ml")).toEqual(ids("AI/ML"));
    expect(ids("ci/cd")).toContain("cicd");
    expect(ids("C++")).toEqual(["cpp"]);
    expect(ids("C#")).toEqual(["csharp"]);
    expect(ids(".NET")).toContain("csharp");
    for (const [query, id] of [
      ["a11y", "accessibility"], ["RAG", "rag"], ["k8s", "kubernetes"],
      ["QA", "test-strategy"], ["SDET", "test-automation"],
      ["graduate", "graduate-career"], ["staff", "staff-influence"],
    ]) expect(ids(query!)).toContain(id);
  });

  it("intersects category and text, and includes reference steps only when they match", () => {
    const mobile = filterNodePresets("react", "mobile");
    expect(mobile.map((preset) => preset.id)).toEqual(["react-native"]);
    expect(filterNodePresets("", "mobile").every((preset) => preset.category === "mobile")).toBe(true);
    expect(ids("react", "databases")).toEqual([]);
    expect(ids("", "unknown-category")).toEqual([]);
    expect(ids("offer", "reference")).toEqual(["offer-discussion"]);
    expect(ids("offer", "career")).toEqual([]);
    expect(ids("qwerty-no-matching-preset")).toEqual([]);
  });
});
