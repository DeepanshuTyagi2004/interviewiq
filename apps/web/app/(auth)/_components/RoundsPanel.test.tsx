import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoundsPanel } from "./RoundsPanel";

describe("RoundsPanel", () => {
  it("shows the 30-45 min label on every sample round, never a fixed length", () => {
    render(<RoundsPanel />);
    expect(screen.getAllByText(/30-45 min/)).toHaveLength(4);
    expect(screen.queryByText(/· 45 min/)).toBeNull();
  });
});
