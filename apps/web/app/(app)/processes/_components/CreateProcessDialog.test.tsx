import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newRoundNode } from "@/features/loops/graph";
import { CreateProcessDialog } from "./CreateProcessDialog";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), push: vi.fn(), source: null as unknown, suggested: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/features/onboarding", () => ({ useCandidateProfile: () => ({ data: null }) }));
vi.mock("@/features/jobs", () => ({
  useJobCompanies: () => ({ data: [{ slug: "example", name: "Example" }] }),
  useJds: () => ({ data: [{ id: "jd-1", title: "Engineer", level: "staff" }] }),
}));
vi.mock("@/features/loops", async (original) => ({
  ...(await original<typeof import("@/features/loops")>()),
  useCreateProcess: () => ({ mutate: mocks.mutate, isPending: false }),
  useProcesses: () => ({ data: [mocks.source] }),
  useOfficialProcess: (id: string) => ({ data: id ? mocks.suggested : undefined }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.source = { id: "p-1", name: "My API process", level: null, legacyLevel: "Career switcher", graph: { nodes: [newRoundNode("system-design", { x: 0, y: 0 })], edges: [] } };
  mocks.suggested = { nodes: [newRoundNode("lld", { x: 0, y: 0 })], edges: [] };
});

async function fill() {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Process name" }), "My practice");
  await user.click(screen.getByRole("combobox", { name: "Process level" }));
  expect(screen.getAllByRole("option")).toHaveLength(9);
  await user.click(screen.getByRole("option", { name: "Staff" }));
  return user;
}

describe("custom process creation", () => {
  it("requires name and an enum level, defaults to one round without a JD, and prevents duplicate submits", async () => {
    render(<CreateProcessDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create and edit" })).toBeDisabled();
    const user = await fill();
    expect(screen.queryByRole("combobox", { name: "Company" })).not.toBeInTheDocument();
    await user.dblClick(screen.getByRole("button", { name: "Create and edit" }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({ name: "My practice", level: "staff", graph: { nodes: [{ kind: "round", type: "dsa" }], edges: [] } });
    expect(mocks.mutate.mock.calls[0][0]).not.toHaveProperty("jdId");
  });

  it("copies an owned graph without attaching the source JD and leaves level editable", async () => {
    render(<CreateProcessDialog open onOpenChange={vi.fn()} />);
    const user = await fill();
    await user.click(screen.getByRole("combobox", { name: "Start from" }));
    await user.click(screen.getByRole("option", { name: "Copy one of my processes" }));
    await user.click(screen.getByRole("combobox", { name: "My process to copy" }));
    await user.click(screen.getByRole("option", { name: "My API process" }));
    expect(screen.getByRole("combobox", { name: "Process level" })).toHaveTextContent("Choose a level");
    expect(screen.getByRole("button", { name: "Create and edit" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Process level" }));
    await user.click(screen.getByRole("option", { name: "Principal" }));
    await user.click(screen.getByRole("button", { name: "Create and edit" }));
    expect(mocks.mutate.mock.calls[0][0]).toEqual({ name: "My practice", level: "principal", graph: (mocks.source as { graph: unknown }).graph });
  });

  it("copies suggested rounds only when a company and role are explicitly selected", async () => {
    render(<CreateProcessDialog open onOpenChange={vi.fn()} />);
    const user = await fill();
    await user.click(screen.getByRole("combobox", { name: "Start from" }));
    await user.click(screen.getByRole("option", { name: "Copy a suggested company / role process" }));
    expect(screen.getByRole("button", { name: "Create and edit" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Company" }));
    await user.click(screen.getByRole("option", { name: "Example" }));
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(screen.getByRole("option", { name: "Engineer · Staff" }));
    await user.click(screen.getByRole("button", { name: "Create and edit" }));
    expect(mocks.mutate.mock.calls[0][0]).toEqual({ name: "My practice", level: "staff", jdId: "jd-1", graph: mocks.suggested });
  });
});
