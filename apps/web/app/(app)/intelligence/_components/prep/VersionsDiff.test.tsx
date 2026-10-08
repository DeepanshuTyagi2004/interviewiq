import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { diff, versions } from "./fixtures";

const h = vi.hoisted(() => ({ diffArgs: [] as unknown[][] }));

vi.mock("@/features/blueprints", () => ({
  useBlueprintVersions: () => ({ data: versions, isPending: false, isError: false, error: null }),
  useBlueprintDiff: (...args: unknown[]) => {
    h.diffArgs.push(args);
    return { data: diff, isPending: false, isError: false, error: null };
  },
}));

import { DiffView, VersionsDiff } from "./VersionsDiff";

beforeEach(() => {
  h.diffArgs = [];
});

describe("VersionsDiff", () => {
  it("lists the versions and diffs the previous version against the newest by default", () => {
    const onSelectRun = vi.fn();
    render(<VersionsDiff sessionId="sess-1" currentRunId="run_aaaaaaaaaaaa" onSelectRun={onSelectRun} />);
    const table = screen.getByRole("region", { name: "Blueprint versions" });
    expect(within(table).getByText("v2")).toBeInTheDocument();
    expect(within(table).getByText("this run")).toBeInTheDocument();
    expect(h.diffArgs.at(-1)).toEqual(["sess-1", 1, 2]);
  });

  it("opens an older version's run", async () => {
    const user = userEvent.setup();
    const onSelectRun = vi.fn();
    render(<VersionsDiff sessionId="sess-1" currentRunId="run_aaaaaaaaaaaa" onSelectRun={onSelectRun} />);
    await user.click(screen.getByRole("button", { name: "run_bbbbbbbb" }));
    expect(onSelectRun).toHaveBeenCalledWith("run_bbbbbbbbbbbb");
  });

  it("asks for two different versions when both pickers match", async () => {
    const user = userEvent.setup();
    render(<VersionsDiff sessionId="sess-1" currentRunId="run_aaaaaaaaaaaa" onSelectRun={vi.fn()} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "From version" }), "2");
    expect(screen.getByText("Pick two different versions.")).toBeInTheDocument();
  });
});

describe("DiffView", () => {
  it("shows the changed inputs, the changed problems, the persona flag, every changed path and the truncation notice", () => {
    render(<DiffView diff={diff} />);
    expect(screen.getByText("profile")).toBeInTheDocument();
    expect(screen.getByText(/core-1:/).closest("li")).toHaveTextContent("valid-anagram");
    expect(screen.getByText(/core-1:/).closest("li")).toHaveTextContent("two-sum");
    expect(screen.getByText("no")).toBeInTheDocument();
    const paths = screen.getByRole("region", { name: "Changed paths" });
    const row = within(paths).getByText("slots[0].problem.slug").closest("tr")!;
    expect(row).toHaveTextContent("valid-anagram");
    expect(row).toHaveTextContent("two-sum");
    expect(screen.getByRole("note")).toHaveTextContent("Truncated");
  });
});
