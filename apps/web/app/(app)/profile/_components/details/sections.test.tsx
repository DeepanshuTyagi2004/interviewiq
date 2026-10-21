import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CandidateProfileRequest, CandidateProfileResponse } from "@/features/onboarding";

const m = vi.hoisted(() => ({
  profile: null as CandidateProfileResponse | null,
  mutate: vi.fn(),
}));

vi.mock("@/features/onboarding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/onboarding")>()),
  useCandidateProfile: () => ({ data: m.profile, isLoading: false }),
  useSaveCandidateProfile: () => ({ mutate: m.mutate, isPending: false }),
}));

import { DetailsProvider } from "./DetailsProvider";
import { AchievementsSection, ContactSection, ExperienceSection, ProjectsSection, SkillsSection } from "./sections";

const base: CandidateProfileResponse = {
  level: "staff",
  fullName: "Asha Rao",
  email: "asha@example.com",
  phone: null,
  location: "Bengaluru",
  headline: null,
  targetRole: null,
  targetJdId: null,
  education: [],
  experience: [
    {
      company: "Flipkart",
      title: "SDE Intern",
      startDate: "May 2024",
      endDate: "Jul 2024",
      location: null,
      bullets: ["- Built a **rate limiter**", "  - Nested point"],
    },
  ],
  projects: [],
  skills: ["Go", "Python"],
  achievements: [],
  detectedLinks: { github: null, leetcode: null, linkedin: null },
  resumeFilename: "asha.pdf",
  resumeParsedAt: null,
  onboardingComplete: true,
};

function renderSections() {
  return render(
    <DetailsProvider>
      <ContactSection />
      <ExperienceSection />
      <ProjectsSection />
      <SkillsSection />
      <AchievementsSection />
    </DetailsProvider>,
  );
}

const card = (name: string) => screen.getByRole("region", { name });
const sent = (): CandidateProfileRequest => m.mutate.mock.calls.at(-1)![0];

beforeEach(() => {
  m.profile = structuredClone(base);
  m.mutate.mockReset();
  m.mutate.mockImplementation((_req, opts: { onSuccess?: () => void }) => opts.onSuccess?.());
});

describe("profile detail sections", () => {
  it("preserves nullable parsed arrays when saving unrelated contact details", async () => {
    const user = userEvent.setup();
    m.profile = {
      ...base,
      portfolioWebsite: "https://asha.example",
      experience: [{ ...base.experience[0], bullets: null, link: "https://acme.example" }],
      projects: [{ name: "Unknown project", description: null, tech: null, bullets: null, link: null }],
    };
    renderSections();
    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    await user.type(screen.getByLabelText("Phone"), "9");
    await user.click(within(card("Contact")).getByRole("button", { name: "Save" }));
    expect(sent().experience[0].bullets).toBeNull();
    expect(sent().projects[0].tech).toBeNull();
    expect(sent().projects[0].bullets).toBeNull();
    expect(sent().portfolioWebsite).toBe("https://asha.example");
    expect(sent().experience[0].link).toBe("https://acme.example");
  });
  it("edits the shared engineering level while preserving other profile details", async () => {
    const user = userEvent.setup();
    renderSections();
    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    await user.click(screen.getByRole("combobox", { name: "Engineering level" }));
    expect(screen.getAllByRole("option")).toHaveLength(9);
    await user.click(screen.getByRole("option", { name: "Principal" }));
    await user.click(within(card("Contact")).getByRole("button", { name: "Save" }));
    expect(sent()).toMatchObject({ level: "principal", fullName: base.fullName, experience: base.experience, skills: base.skills });
  });

  it("requires a choice when repairing a legacy profile in Contact", async () => {
    const user = userEvent.setup();
    m.profile = { ...base, level: null, legacyLevel: "Career switcher" };
    renderSections();
    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    await user.type(screen.getByLabelText("Phone"), "9");
    await user.click(within(card("Contact")).getByRole("button", { name: "Save" }));
    expect(m.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Choose your engineering level")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Engineering level" }));
    await user.click(screen.getByRole("option", { name: "Intern" }));
    await user.click(within(card("Contact")).getByRole("button", { name: "Save" }));
    expect(sent().level).toBe("intern");
  });
  it("leaves unknown saved level metadata alone when saving unrelated details", async () => {
    const user = userEvent.setup();
    m.profile = { ...base, level: null, legacyLevel: "Career switcher" };
    renderSections();
    await user.click(screen.getByRole("button", { name: "Edit experience" }));
    await user.type(within(card("Experience")).getByDisplayValue("Flipkart"), " India");
    await user.click(within(card("Experience")).getByRole("button", { name: "Save" }));
    expect(sent()).not.toHaveProperty("level");
    expect(sent().experience[0].company).toBe("Flipkart India");
  });
  it("shows the read-only views, with formatted highlights", () => {
    renderSections();
    expect(within(card("Experience")).getByText("rate limiter").tagName).toBe("STRONG");
    expect(within(card("Skills")).getByText("Python")).toBeInTheDocument();
    expect(within(card("Contact")).getByText("asha@example.com")).toBeInTheDocument();
  });

  it("renders safe experience and project links in a new tab", () => {
    m.profile = {
      ...base,
      experience: [{ ...base.experience[0], link: "https://acme.example/work" }],
      projects: [{ name: "Relay", description: null, tech: null, bullets: null, link: "https://github.com/asha/relay" }],
    };
    renderSections();
    expect(within(card("Experience")).getByRole("link")).toHaveAttribute("target", "_blank");
    expect(within(card("Experience")).getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(card("Projects")).getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("edits one section at a time and switches freely when nothing changed", async () => {
    const user = userEvent.setup();
    renderSections();
    await user.click(screen.getByRole("button", { name: "Edit experience" }));
    expect(within(card("Experience")).getByDisplayValue("Flipkart")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Full name")).toHaveFocus();
    expect(within(card("Experience")).queryByDisplayValue("Flipkart")).toBeNull();
  });

  it("asks before discarding unsaved changes, and can keep or drop them", async () => {
    const user = userEvent.setup();
    renderSections();
    await user.click(screen.getByRole("button", { name: "Edit experience" }));
    const company = within(card("Experience")).getByDisplayValue("Flipkart");
    await user.type(company, " India");

    await user.click(screen.getByRole("button", { name: "Edit skills" }));
    expect(screen.getByRole("dialog", { name: "Discard changes to Experience?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(within(card("Experience")).getByDisplayValue("Flipkart India")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit skills" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(within(card("Experience")).queryByDisplayValue("Flipkart India")).toBeNull();
    expect(within(card("Experience")).getByText("Flipkart")).toBeInTheDocument();
    expect(m.mutate).not.toHaveBeenCalled();
  });

  it("saves the whole profile with only the edited section changed", async () => {
    const user = userEvent.setup();
    renderSections();
    await user.click(screen.getByRole("button", { name: "Edit experience" }));
    const title = within(card("Experience")).getByDisplayValue("SDE Intern");
    await user.clear(title);
    await user.type(title, "Backend Intern");
    await user.click(within(card("Experience")).getByRole("button", { name: "Save" }));

    expect(m.mutate).toHaveBeenCalledTimes(1);
    expect(sent().experience[0].title).toBe("Backend Intern");
    expect(sent().experience[0].bullets).toEqual(["- Built a **rate limiter**", "  - Nested point"]);
    expect(sent().skills).toEqual(["Go", "Python"]);
    expect(sent().fullName).toBe("Asha Rao");
    expect(sent()).not.toHaveProperty("level");
    expect(sent().complete).toBe(false);
    // Back to the view, focus on that section's Edit.
    expect(screen.getByRole("button", { name: "Edit experience" })).toHaveFocus();
  });

  it("validates only the open section", async () => {
    const user = userEvent.setup();
    m.profile = { ...structuredClone(base), fullName: null };
    renderSections();

    // A missing name doesn't block saving Experience…
    await user.click(screen.getByRole("button", { name: "Edit experience" }));
    await user.type(within(card("Experience")).getByDisplayValue("Flipkart"), "!");
    await user.click(within(card("Experience")).getByRole("button", { name: "Save" }));
    expect(m.mutate).toHaveBeenCalledTimes(1);

    // …but does block saving Contact, with the error shown there.
    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    await user.type(screen.getByLabelText("Phone"), "9");
    await user.click(within(card("Contact")).getByRole("button", { name: "Save" }));
    expect(m.mutate).toHaveBeenCalledTimes(1);
    expect(within(card("Contact")).getByText("Your name is required")).toBeInTheDocument();
  });

  it("shows header counts as a quiet entry count", async () => {
    const user = userEvent.setup();
    renderSections();
    expect(within(card("Skills")).getByText("2 entries")).toBeInTheDocument();
    expect(within(card("Experience")).getByText("1 entry")).toBeInTheDocument();
    // An empty section shows no count.
    expect(within(card("Projects")).queryByText(/^\d+$/)).toBeNull();

    // While editing, the count gives way to the "Editing" pill.
    await user.click(screen.getByRole("button", { name: "Edit skills" }));
    expect(within(card("Skills")).getByText("Editing")).toBeInTheDocument();
    expect(within(card("Skills")).queryByText("2 entries")).toBeNull();
  });

  it("an empty section offers Add, which opens it with one blank row", async () => {
    const user = userEvent.setup();
    renderSections();
    expect(within(card("Projects")).getByText("Add side, academic or open-source projects.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add projects" }));
    expect(within(card("Projects")).getAllByLabelText("Name")).toHaveLength(1);
    expect(within(card("Projects")).getByRole("button", { name: "Add project" })).toBeInTheDocument();
  });

  it("keeps the empty achievements state neutral", () => {
    renderSections();
    const achievements = card("Achievements");
    expect(within(achievements).getByText("No achievements added")).toBeInTheDocument();
    expect(within(achievements).queryByText("Add awards, hackathons, contests or scholarships.")).toBeNull();
    expect(within(achievements).getByRole("button", { name: "Add achievements" })).toBeInTheDocument();
  });
});
