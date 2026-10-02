import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Building2, LayoutDashboard } from "lucide-react";

const push = vi.hoisted(() => vi.fn());

vi.mock("@/features/jobs", () => ({
  useJds: () => ({
    data: [{ id: "jd1", title: "SDE I", companyName: "Meesho", company: "meesho", role: "SDE", specialization: null }],
    isLoading: false,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { CommandMenu } from "./CommandMenu";

const ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Companies", href: "/jobs", icon: Building2 },
];

describe("CommandMenu", () => {
  it("groups screens and roles under counted headers, with a result count", () => {
    render(<CommandMenu open onOpenChange={() => {}} items={ITEMS} />);
    expect(screen.getByText("Screens")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("3 results")).toBeInTheDocument();
    // Headers aren't options: only the three entries are.
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("keeps keyboard navigation across groups and opens the active entry", async () => {
    const onOpenChange = vi.fn();
    render(<CommandMenu open onOpenChange={onOpenChange} items={ITEMS} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "{ArrowDown}{ArrowDown}{Enter}");
    expect(push).toHaveBeenCalledWith("/jobs/jd1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("filters and drops an empty group", async () => {
    render(<CommandMenu open onOpenChange={() => {}} items={ITEMS} />);
    await userEvent.type(screen.getByRole("combobox"), "meesho");
    expect(screen.queryByText("Screens")).toBeNull();
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });
});
