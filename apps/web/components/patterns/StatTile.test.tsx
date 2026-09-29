import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("renders the value in a font-mono element and the label", () => {
    render(<StatTile value="1,204" label="Contributions" />);
    const value = screen.getByText("1,204");
    expect(value).toBeInTheDocument();
    expect(value.className).toMatch(/font-mono/);
    expect(screen.getByText("Contributions")).toBeInTheDocument();
  });

  it("contains no scoring or ranking language", () => {
    const { container } = render(<StatTile value="38" label="Public repos" />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/score|rank|grade|percentile|above average/i);
  });
});
