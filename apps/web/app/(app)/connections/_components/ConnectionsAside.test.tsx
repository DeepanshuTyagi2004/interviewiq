import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { profileState, resumeState } = vi.hoisted(() => ({
  profileState: { data: undefined as unknown },
  resumeState: { hasProfile: false },
}));

vi.mock("@/features/profile", () => ({ useProfile: () => profileState }));
vi.mock("./useResumeImport", () => ({ useResumeImport: () => resumeState }));

import { ConnectionsAside } from "./ConnectionsAside";
import { PROVIDERS } from "./providers";

const live = PROVIDERS.filter((p) => p.live).length;

describe("ConnectionsAside", () => {
  it("reads out linked sources as a padded count with a matching meter", () => {
    profileState.data = { sources: [{ source: "GITHUB", connected: true }] };
    resumeState.hasProfile = true;
    const { container } = render(<ConnectionsAside />);

    expect(screen.getByText("Sources linked")).toBeInTheDocument();
    expect(screen.getByText(`of ${live}`)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-seg]")).toHaveLength(live);
    expect(container.querySelectorAll("[data-seg='on']")).toHaveLength(2);
    // Screen readers still get the sentence.
    expect(screen.getByText(`2 of ${live} available sources connected`)).toHaveClass("sr-only");
  });

  it("shows a dash and an empty meter before the profile loads", () => {
    profileState.data = undefined;
    resumeState.hasProfile = true;
    const { container } = render(<ConnectionsAside />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-seg='on']")).toHaveLength(0);
  });
});
