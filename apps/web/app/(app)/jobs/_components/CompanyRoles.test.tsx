import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { selectOption } from "@/tests/helpers/select-option";
import type { JdSummary } from "@/features/jobs";
import { CompanyRoles } from "./CompanyRoles";

type FitRow = { jdId: string; score: number | null; levelGap: string; cap: number | null; levelFactor?: number | null };
type FitState = { data?: { configVersion: string; userLevel: string | null; results: FitRow[] }; isLoading: boolean; isError: boolean };
const state = vi.hoisted(() => ({ query: "", replace: vi.fn(), fit: { isLoading: false, isError: false } as FitState }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace }), usePathname: () => "/jobs/c/example", useSearchParams: () => new URLSearchParams(state.query) }));
const roles: JdSummary[] = [
  { id: "real", company: "example", companyName: "Example", title: "Real role", role: "backend", level: "sde2", specialization: null, dataAvailability: "available", dataConfidence: "medium", ctcMaxLpa: 50, yoeMin: 2 },
  { id: "template", practiceTemplate: true, company: "example", companyName: "Example", title: "[Practice template] Simulated role", role: "backend", level: "sde2", specialization: null, dataAvailability: "rich", dataConfidence: "high", ctcMaxLpa: 99, yoeMin: 0 },
];
vi.mock("@/features/jobs", () => ({
  useJds: () => ({ data: roles, isSuccess: true }),
  useJdFitList: () => state.fit,
  useJobCompanies: () => ({ data: [{ slug: "example", name: "Example" }] }),
}));

const fitList = (userLevel: string | null, results: FitRow[]): FitState =>
  ({ data: { configVersion: "jd-fit-v1", userLevel, results }, isLoading: false, isError: false });

beforeEach(() => { state.query = ""; state.fit = { isLoading: false, isError: false }; vi.clearAllMocks(); });
describe("CompanyRoles", () => {
  it("preserves numeric filter URL values through the themed pickers", async () => {
    const user = userEvent.setup();
    render(<CompanyRoles slug="example" />);
    await selectOption(screen.getByRole("combobox", { name: "Minimum pay" }), "₹20+ LPA", user);
    expect(state.replace).toHaveBeenLastCalledWith("/jobs/c/example?minPay=20", { scroll: false });
    await selectOption(screen.getByRole("combobox", { name: "Maximum experience" }), "Up to 2 yrs", user);
    expect(state.replace).toHaveBeenLastCalledWith("/jobs/c/example?maxYoe=2", { scroll: false });
    const sort = screen.getByRole("combobox", { name: "Sort roles" });
    sort.focus(); await user.keyboard("{ArrowDown}title{Enter}");
    expect(state.replace).toHaveBeenLastCalledWith("/jobs/c/example?sort=title", { scroll: false });
    expect(sort).toHaveFocus();
  });

  it("keeps the secondary filters behind a toggle, open only when one is already applied", async () => {
    const user = userEvent.setup();
    state.query = "";
    const view = render(<CompanyRoles slug="example" />);
    const toggle = screen.getByRole("button", { name: /more filters/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: /fewer filters/i })).toHaveAttribute("aria-expanded", "true");
    view.unmount();
    state.query = "minPay=20";
    render(<CompanyRoles slug="example" />);
    expect(screen.getByRole("button", { name: /fewer filters/i })).toHaveAttribute("aria-expanded", "true");
    state.query = "";
  });

  it("never displays simulated salary or high evidence and excludes templates from researched/pay filters", () => {
    const view = render(<CompanyRoles slug="example" />);
    expect(screen.getByText("Practice template")).toBeInTheDocument();
    expect(screen.queryByText("High")).not.toBeInTheDocument();
    expect(screen.queryByText(/₹99/)).not.toBeInTheDocument();
    state.query = "researched=1"; view.rerender(<CompanyRoles slug="example" />);
    expect(screen.queryByRole("link", { name: /Simulated role/ })).not.toBeInTheDocument();
    state.query = "minPay=20"; view.rerender(<CompanyRoles slug="example" />);
    expect(screen.queryByRole("link", { name: /Simulated role/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Real role/ })).toBeInTheDocument();
  });

  it("shows each role's match and labels a capped stretch role without eligibility wording", () => {
    state.fit = fitList("fresher", [
      { jdId: "real", score: 40, levelGap: "stretch", cap: 40 },
      { jdId: "template", score: 72, levelGap: "none", cap: null },
    ]);
    render(<CompanyRoles slug="example" />);
    expect(screen.getByText("72% match")).toBeInTheDocument();
    expect(screen.getByText("≤40% match")).toBeInTheDocument();
    expect(screen.getByText(/Stretch role/)).toBeInTheDocument();
    expect(screen.queryByText(/eligib|qualif|shortlist/i)).not.toBeInTheDocument();
  });

  it("renders the cards exactly as before when the match request fails", () => {
    state.fit = { isLoading: false, isError: true };
    render(<CompanyRoles slug="example" />);
    expect(screen.getByRole("link", { name: /Real role/ })).toBeInTheDocument();
    expect(screen.queryByText(/% match/)).not.toBeInTheDocument();
  });

  it("sorts by best match, unscored roles last", () => {
    state.fit = fitList("sde2", [{ jdId: "template", score: 80, levelGap: "none", cap: null }, { jdId: "real", score: null, levelGap: "none", cap: null }]);
    state.query = "sort=match";
    render(<CompanyRoles slug="example" />);
    const links = screen.getAllByRole("link").filter((a) => /role/i.test(a.textContent ?? ""));
    expect(links.map((a) => a.textContent)).toEqual([expect.stringMatching(/Simulated role/), expect.stringMatching(/Real role/)]);
  });

  it("nudges the user to set a level only when it is unset", () => {
    state.fit = fitList(null, [{ jdId: "real", score: 55, levelGap: "unknown", cap: null }]);
    const view = render(<CompanyRoles slug="example" />);
    expect(screen.getByRole("link", { name: "Set your level" })).toHaveAttribute("href", "/profile");
    state.fit = fitList("sde2", [{ jdId: "real", score: 55, levelGap: "none", cap: null }]);
    view.rerender(<CompanyRoles slug="example" />);
    expect(screen.queryByRole("link", { name: "Set your level" })).not.toBeInTheDocument();
  });
});
