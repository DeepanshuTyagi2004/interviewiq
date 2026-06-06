import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// APP_CONFIG.apiUrl reads NEXT_PUBLIC_API_URL at import time; stub the module.
vi.mock("@/lib/constants/config", () => ({
  APP_CONFIG: { apiUrl: "http://localhost:8080" },
}));

import { ConnectionButton } from "./ConnectionButton";

describe("ConnectionButton", () => {
  beforeEach(() => {
    // jsdom forbids assigning window.location.href directly; replace the object.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "" },
    });
  });

  it("navigates to the GitHub authorize endpoint on click", async () => {
    const user = userEvent.setup();
    render(<ConnectionButton source="GITHUB" />);
    await user.click(screen.getByRole("button", { name: /connect github/i }));
    expect(window.location.href).toBe(
      "http://localhost:8080/api/v1/connections/github/authorize",
    );
  });
});
