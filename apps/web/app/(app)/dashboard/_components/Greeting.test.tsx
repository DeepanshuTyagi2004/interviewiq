import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Greeting, dateEyebrow } from "./Greeting";

describe("dateEyebrow", () => {
  it("reads full weekday, day and month, with no clock time", () => {
    expect(dateEyebrow(new Date(2026, 9, 18, 12, 30))).toBe("Sunday, 18 October");
    expect(dateEyebrow(new Date(2026, 0, 7, 23, 59))).toBe("Wednesday, 7 January");
  });
});

describe("Greeting", () => {
  it("shows the date eyebrow, the greeting and both actions", () => {
    render(<Greeting name="Asha Rao" roomHref="/interviews" now={new Date(2026, 9, 2, 12, 30)} />);
    expect(screen.getByText("Friday, 2 October")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Good afternoon, Asha" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore companies" })).toHaveAttribute("href", "/jobs");
    expect(screen.getByRole("link", { name: "Schedule a round" })).toHaveAttribute("href", "/interviews");
  });

  it("greets by the hour: morning before 12, afternoon before 17, evening after", () => {
    const at = (h: number) => {
      const { unmount } = render(<Greeting name="Asha" roomHref="/x" now={new Date(2026, 9, 2, h)} />);
      const text = screen.getByRole("heading", { level: 1 }).textContent;
      unmount();
      return text;
    };
    expect(at(11)).toBe("Good morning, Asha");
    expect(at(12)).toBe("Good afternoon, Asha");
    expect(at(16)).toBe("Good afternoon, Asha");
    expect(at(17)).toBe("Good evening, Asha");
  });

  it("drops the name when there is none", () => {
    render(<Greeting name={null} roomHref="/x" now={new Date(2026, 9, 2, 9)} />);
    expect(screen.getByRole("heading", { level: 1, name: "Good morning" })).toBeInTheDocument();
  });
});
