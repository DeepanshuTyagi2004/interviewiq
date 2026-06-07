import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// apiFetch sends the Bearer token; stub it so the test asserts the fetch+navigate flow.
const apiFetchMock = vi.fn();
vi.mock("@/lib/api-client/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { ConnectionButton } from "./ConnectionButton";

describe("ConnectionButton", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    // jsdom forbids assigning window.location.href directly; replace the object.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "" },
    });
  });

  it("fetches the authorize URL via apiFetch then navigates to it on click", async () => {
    const githubUrl =
      "https://github.com/login/oauth/authorize?client_id=abc&state=xyz";
    apiFetchMock.mockResolvedValue({ url: githubUrl });

    const user = userEvent.setup();
    render(<ConnectionButton source="GITHUB" />);
    await user.click(screen.getByRole("button", { name: /connect github/i }));

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/connections/github/authorize");
    await waitFor(() => expect(window.location.href).toBe(githubUrl));
  });
});
