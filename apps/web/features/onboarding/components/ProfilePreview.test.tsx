import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { emptyCandidateForm, useCandidateForm, type CandidateFormValues } from "../form";
import { ProfilePreview } from "./ProfilePreview";

vi.mock("@/features/profile", () => ({
  useProfile: () => ({
    data: {
      sources: [
        { source: "GITHUB", connected: true },
        { source: "LEETCODE", connected: false },
      ],
      fragments: { github: { login: "asha" } },
    },
  }),
}));

function Harness({ values, target = null }: { values: CandidateFormValues; target?: string | null }) {
  const form = useCandidateForm(values);
  return <ProfilePreview control={form.control} target={target} />;
}

const values: CandidateFormValues = {
  ...emptyCandidateForm,
  fullName: "Asha Rao",
  location: "Bengaluru",
  education: [
    { institution: "DPS", degree: "Class XII", field: "PCM", startYear: "2019", endYear: "2021", grade: "" },
    { institution: "RVCE", degree: "B.E.", field: "CSE", startYear: "2021", endYear: "2025", grade: "" },
  ],
  experience: [
    { company: "Flipkart", title: "SDE Intern", startDate: "May 2024", endDate: "Jul 2024", location: "", bulletsText: "" },
  ],
  skillsText: Array.from({ length: 14 }, (_, i) => `Skill${i + 1}`).join(", "),
};

describe("ProfilePreview", () => {
  it("mirrors the profile: highest degree, roles, connected sources, skills with +N more", () => {
    render(<Harness values={values} target="Meesho · SDE I" />);
    expect(screen.getByText("B.E. CSE · RVCE · 2025")).toBeInTheDocument();
    expect(screen.getByText("SDE Intern · Flipkart")).toBeInTheDocument();
    expect(screen.getByText("@asha")).toBeInTheDocument();
    expect(screen.getByText("Skill12")).toBeInTheDocument();
    expect(screen.queryByText("Skill13")).toBeNull();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.getByText("Meesho · SDE I")).toBeInTheDocument();
  });

  it("lists what's still missing — never a score or percentage", () => {
    const { container } = render(<Harness values={values} />);
    expect(screen.getByText("headline")).toBeInTheDocument();
    expect(screen.getByText("Interview score")).toBeInTheDocument();
    expect(screen.queryByText("Profile score")).not.toBeInTheDocument();
    expect(screen.getAllByText("Not scored yet")).toHaveLength(1);
    expect(container.textContent).not.toMatch(/\d+\s*%/);
  });

  it("names every gap on an empty profile", () => {
    render(<Harness values={emptyCandidateForm} />);
    expect(screen.getByText("name, headline, education, experience or projects, skills")).toBeInTheDocument();
  });
});
