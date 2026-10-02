import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Greeting, dateEyebrow } from "./Greeting";

describe("dateEyebrow", () => {
  it("reads weekday, padded day and month in mixed case (CSS upper-cases it), with no clock time", () => {
    expect(dateEyebrow(new Date(2026, 9, 2, 12, 30))).toBe("Fri 02 Oct");
  });

  it("pads single-digit days and ignores the time of day", () => {
    expect(dateEyebrow(new Date(2026, 0, 7, 0, 5))).toBe("Wed 07 Jan");
    expect(dateEyebrow(new Date(2026, 0, 7, 23, 59))).toBe("Wed 07 Jan");
  });
});

describe("Greeting", () => {
  it("shows the date readout from the now prop", () => {
    render(<Greeting name="Asha Rao" summary="Pick a company." roomHref="/interviews" now={new Date(2026, 9, 2, 12, 30)} />);
    const eyebrow = screen.getByText("Fri 02 Oct");
    expect(eyebrow).toHaveClass("iq-eyebrow");
    expect(eyebrow.textContent).not.toMatch(/\d{1,2}:\d{2}/);
    expect(screen.getByRole("heading", { level: 1, name: "Good afternoon, Asha" })).toBeInTheDocument();
  });
});
