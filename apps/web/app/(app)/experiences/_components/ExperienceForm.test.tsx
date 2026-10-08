import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mutate, state } = vi.hoisted(() => ({
  mutate: vi.fn(),
  state: { isPending: false, isSuccess: false },
}));

vi.mock("@/features/experiences", () => ({
  useSubmitExperience: () => ({ mutate, ...state }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: class extends Error {} }));

import { ExperienceForm, MIN_CONTENT } from "./ExperienceForm";

describe("ExperienceForm", () => {
  beforeEach(() => {
    mutate.mockReset();
    state.isSuccess = false;
  });

  it("keeps Submit disabled until there's a company and enough detail", async () => {
    const user = userEvent.setup();
    render(<ExperienceForm />);
    const submit = screen.getByRole("button", { name: /submit experience/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/company/i), "Meesho");
    await user.type(screen.getByLabelText(/what happened/i), "x".repeat(MIN_CONTENT - 1));
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/what happened/i), "x");
    expect(submit).toBeEnabled();
  });

  it("posts the trimmed company, the picked level and the write-up", async () => {
    const user = userEvent.setup();
    render(<ExperienceForm />);
    await user.type(screen.getByLabelText(/company/i), "  Meesho ");
    await user.click(screen.getByRole("radio", { name: "SDE II" }));
    await user.type(screen.getByLabelText(/what happened/i), "Round 1 was DSA on arrays and a heap problem.");
    await user.click(screen.getByRole("button", { name: /submit experience/i }));

    expect(mutate).toHaveBeenCalledWith(
      { company: "Meesho", level: "sde2", content: "Round 1 was DSA on arrays and a heap problem." },
      expect.any(Object),
    );
  });

  it("sits in a card region named by its title", () => {
    render(<ExperienceForm />);
    expect(screen.getByRole("region", { name: "Your experience" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your experience" })).toBeInTheDocument();
  });

  it("shows the level choices as a radio group with Fresher selected by default", () => {
    render(<ExperienceForm />);
    expect(screen.getByRole("group", { name: /level/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    expect(screen.getByRole("radio", { name: "Intern" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Distinguished" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Fresher" })).toBeChecked();
  });
});
