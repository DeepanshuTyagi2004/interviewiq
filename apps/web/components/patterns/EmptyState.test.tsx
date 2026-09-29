import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title, hint and an action, and fires the action on click", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No connections yet"
        hint="Connect a source to build your profile."
        action={
          <button type="button" onClick={onClick}>
            Connect GitHub
          </button>
        }
      />,
    );

    expect(screen.getByText("No connections yet")).toBeInTheDocument();
    expect(
      screen.getByText("Connect a source to build your profile."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /connect github/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders without a hint or action", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
