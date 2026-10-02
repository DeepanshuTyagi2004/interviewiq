import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StubScreen } from "./StubScreen";

describe("StubScreen", () => {
  it("shows the title, the not-built tag and the default hint", () => {
    render(<StubScreen title="Practice" />);
    expect(screen.getByRole("region", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByText("Not built yet")).toBeInTheDocument();
    expect(screen.getByText("This screen is on the way.")).toBeInTheDocument();
  });

  it("uses a custom hint when given", () => {
    render(<StubScreen title="Loops" hint="Coming with Module 02." />);
    expect(screen.getByText("Coming with Module 02.")).toBeInTheDocument();
    expect(screen.queryByText("This screen is on the way.")).toBeNull();
  });
});
