import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeEvent, makeItem } from "@/features/research/testing";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: class extends Error {}, apiFetch: vi.fn() }));

import { LiveConsole } from "./LiveConsole";

const EVENTS = [
  makeEvent({ seq: 1, level: "debug", level_rank: 10, type: "span.start", message: "node · resolve", span_id: "s1", company_id: "c-meesho", node: "resolve" }),
  makeEvent({ seq: 2, level: "warn", level_rank: 30, message: "Meesho evidence dropped", company_id: "c-meesho", node: "resolve" }),
];

function renderConsole(onSelectSpan = vi.fn()) {
  render(<LiveConsole events={EVENTS} items={[makeItem()]} live onSelectSpan={onSelectSpan} canLoadOlder={false} onLoadOlder={vi.fn()} loadingOlder={false} />);
  return onSelectSpan;
}

describe("LiveConsole", () => {
  it("filters by minimum level and by text", async () => {
    renderConsole();
    expect(screen.getByText("node · resolve")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Minimum level"), "warn");
    expect(screen.queryByText("node · resolve")).not.toBeInTheDocument();
    expect(screen.getByText("Meesho evidence dropped")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Minimum level"), "trace");
    await userEvent.type(screen.getByLabelText("Search messages"), "evidence");
    expect(screen.queryByText("node · resolve")).not.toBeInTheDocument();
  });

  it("clicking a line that belongs to a step selects that step", async () => {
    const onSelectSpan = renderConsole();
    await userEvent.click(screen.getByText("node · resolve"));
    expect(onSelectSpan).toHaveBeenCalledWith("s1", "c-meesho");
  });

  it("copies only the visible lines", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderConsole();
    await userEvent.selectOptions(screen.getByLabelText("Minimum level"), "warn");
    await userEvent.click(screen.getByRole("button", { name: "Copy visible" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain("Meesho evidence dropped");
    expect(writeText.mock.calls[0]![0]).not.toContain("node · resolve");
  });
});
