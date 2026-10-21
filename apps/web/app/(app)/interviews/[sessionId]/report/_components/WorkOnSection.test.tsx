import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/features/report", async () => {
  const actual = await vi.importActual<typeof import("@/features/report")>("@/features/report/presentation");
  return { ...actual };
});

import { WorkOnSection } from "./WorkOnSection";

const report = {
  focus: [],
  topicGaps: [
    {
      subject: "DSA",
      topics: [
        {
          topic: "Graphs",
          why: "Part of Course Schedule, a problem you asked to switch away from.",
          practice: [
            { slug: "course-schedule", title: "Course Schedule", difficulty: "medium", retry: true },
            { slug: "number-of-islands", title: "Number of Islands", difficulty: "medium" },
          ],
        },
      ],
    },
  ],
} as never;

describe("WorkOnSection", () => {
  it("tags the abandoned problem with Retry this problem, and only it", () => {
    render(<WorkOnSection report={report} />);
    expect(screen.getAllByText("Retry this problem")).toHaveLength(1);
    expect(screen.getByText("Course Schedule")).toBeInTheDocument();
  });
});
