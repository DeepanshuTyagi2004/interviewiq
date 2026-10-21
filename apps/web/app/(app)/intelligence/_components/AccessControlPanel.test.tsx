import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiFetchError } from "@/lib/api-client/errors";
import { AccessControlPanel } from "./AccessControlPanel";

const mutate = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u-admin" } }) }));
vi.mock("@/features/intelligence", () => ({
  useUsers: () => ({
    isLoading: false,
    isError: false,
    data: [
      { id: "u-admin", name: "Grace", email: "grace@example.test", role: "ADMIN" },
      { id: "u-ada", name: "Ada", email: "ada@example.test", role: "USER" },
    ],
  }),
  useUpdateUserRole: () => ({ mutate, isPending: false, variables: undefined }),
}));

describe("AccessControlPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers Candidate, User and Admin in each row's select", () => {
    render(<AccessControlPanel />);
    const select = screen.getByLabelText("Role for Ada");
    const labels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["Candidate", "User", "Admin"]);
  });

  it("fires the mutation with the chosen role", async () => {
    render(<AccessControlPanel />);
    await userEvent.selectOptions(screen.getByLabelText("Role for Ada"), "CANDIDATE");
    expect(mutate).toHaveBeenCalledWith({ id: "u-ada", role: "CANDIDATE" }, expect.any(Object));
  });

  it("disables the signed-in user's own row", () => {
    render(<AccessControlPanel />);
    expect(screen.getByLabelText("Role for Grace")).toBeDisabled();
    expect(screen.getByLabelText("Role for Ada")).toBeEnabled();
  });

  it("shows the last-admin message when the API refuses", async () => {
    mutate.mockImplementation((_vars, opts) =>
      opts.onError(new ApiFetchError(409, "last_admin", "Cannot remove the last admin")),
    );
    render(<AccessControlPanel />);
    await userEvent.selectOptions(screen.getByLabelText("Role for Ada"), "ADMIN");
    expect(toastError).toHaveBeenCalledWith("Cannot remove the last admin");
  });
});
