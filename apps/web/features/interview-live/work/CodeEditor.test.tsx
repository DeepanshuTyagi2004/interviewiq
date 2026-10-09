import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockLiveSession } from "../session/MockLiveSession";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import { CodeEditor } from "./CodeEditor";

vi.mock("next/dynamic", () => ({ default: () => ({ language }: { language: string }) => <div data-testid="monaco" data-language={language} /> }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

describe("CodeEditor language picker", () => {
  it("supports keyboard selection, restores focus and sends the selected runnable language", async () => {
    const user = userEvent.setup();
    const session = new MockLiveSession();
    render(<WorkspaceProvider session={session}><CodeEditor session={session} /></WorkspaceProvider>);
    const trigger = screen.getByRole("combobox", { name: "Language" });
    expect(trigger.id).toBe("code-language");
    trigger.focus();
    await user.keyboard("{ArrowDown}t{Enter}");
    expect(trigger).toHaveFocus();
    expect(screen.getByTestId("monaco")).toHaveAttribute("data-language", "typescript");
    await waitFor(() => expect(session.sentOf("code.snapshot").at(-1)).toMatchObject({ text: "// write your solution here\n", language: "typescript" }), { timeout: 2000 });
  });
});
