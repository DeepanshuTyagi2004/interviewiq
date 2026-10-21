import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Count, HudCard, HudEmpty, Kbd, Readout, SegmentMeter, StatusDot, clampFilled, dotClass, padCount } from ".";

describe("clampFilled", () => {
  it.each([
    [2, 5, 2],
    [-1, 5, 0],
    [9, 5, 5],
    [2.6, 5, 3],
    [Number.NaN, 5, 0],
    [3, 0, 0],
  ])("clampFilled(%s, %s) = %s", (filled, segments, expected) => {
    expect(clampFilled(filled, segments)).toBe(expected);
  });
});

describe("SegmentMeter", () => {
  it("fills the clamped number of segments", () => {
    const { container } = render(<SegmentMeter segments={5} filled={2} />);
    expect(container.querySelectorAll("[data-seg]")).toHaveLength(5);
    expect(container.querySelectorAll("[data-seg='on']")).toHaveLength(2);
  });

  it("is an image with a label when labelled, hidden otherwise", () => {
    const { rerender } = render(<SegmentMeter segments={5} filled={2} label="Data depth 2 of 5" />);
    expect(screen.getByRole("img", { name: "Data depth 2 of 5" })).toBeInTheDocument();
    rerender(<SegmentMeter segments={5} filled={2} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("StatusDot", () => {
  it("pulses only when live", () => {
    expect(dotClass("live")).toContain("iq-breathe");
    for (const s of ["active", "idle", "warn", "error"] as const) {
      expect(dotClass(s)).not.toContain("animate-");
    }
  });

  it("shows its label, or an sr-only one", () => {
    const { rerender } = render(<StatusDot state="active" label="Live" />);
    expect(screen.getByText("Live")).toBeVisible();
    rerender(<StatusDot state="idle" srLabel="Not connected" />);
    expect(screen.getByText("Not connected")).toHaveClass("sr-only");
  });
});

describe("HudCard", () => {
  it("renders title, meta, action, footer and names the region", () => {
    render(
      <HudCard title="Recent interviews" meta="03" action={<button type="button">All</button>} footer="SRC 02">
        body
      </HudCard>,
    );
    expect(screen.getByRole("region", { name: "Recent interviews" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent interviews" })).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByText("SRC 02")).toBeInTheDocument();
  });

  it("ignores the dropped HUD props and maps tone", () => {
    const { container, rerender } = render(
      <HudCard title="T" notch glow="tl" active spotlight>
        x
      </HudCard>,
    );
    expect(container.querySelector(".hud-ticks, .hud-notch, .hud-spot, .hud-ember")).toBeNull();
    rerender(
      <HudCard title="T" tone="inverse">
        x
      </HudCard>,
    );
    expect(container.firstElementChild).toHaveClass("bg-ink");
    rerender(
      <HudCard title="T" tone="sunken">
        x
      </HudCard>,
    );
    expect(container.firstElementChild).toHaveClass("bg-surface");
  });

  it("renders flush when the caller brings a body class", () => {
    const { container } = render(
      <HudCard title="T" bodyClassName="p-4">
        <span>inner</span>
      </HudCard>,
    );
    expect(container.firstElementChild).not.toHaveClass("p-[22px]");
    expect(screen.getByText("inner").parentElement).toHaveClass("p-4");
  });

  it("can render without a header, named by aria-label or aria-labelledby", () => {
    const { container, rerender } = render(<HudCard aria-label="Plain">x</HudCard>);
    expect(container.querySelector("[data-hud-header]")).toBeNull();
    expect(screen.getByRole("region", { name: "Plain" })).toBeInTheDocument();
    rerender(
      <HudCard as="article" aria-labelledby="h">
        <h2 id="h">Meesho</h2>
      </HudCard>,
    );
    expect(screen.getByRole("article", { name: "Meesho" })).toBeInTheDocument();
  });
});

describe("HudEmpty / Readout / Kbd", () => {
  it("HudEmpty shows the copy and ignores the tag", () => {
    render(<HudEmpty title="No interviews yet" hint="Book one." tag="No data" />);
    expect(screen.queryByText("No data")).toBeNull();
    expect(screen.getByText("No interviews yet")).toBeInTheDocument();
    expect(screen.getByText("Book one.")).toBeInTheDocument();
  });

  it("Readout shows label, value and note", () => {
    render(<Readout label="Interview score" value="—" note="coming soon" />);
    expect(screen.getByText("Interview score")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("coming soon")).toBeInTheDocument();
  });

  it("Kbd reads its label to screen readers", () => {
    render(<Kbd label="Command K">⌘K</Kbd>);
    expect(screen.getByText("Command K")).toHaveClass("sr-only");
  });
});

describe("padCount / Count", () => {
  it.each([
    [2, "02"],
    [12, "12"],
    [0, "00"],
    [-3, "00"],
    [2.7, "02"],
    [Number.NaN, "—"],
  ])("padCount(%s) = %s", (n, out) => {
    expect(padCount(n)).toBe(out);
  });

  it("shows a plain count and reads plain words", () => {
    render(<Count n={2} label="2 sessions" />);
    expect(screen.getByText("2")).toHaveAttribute("aria-hidden");
    expect(screen.getByText("2 sessions")).toHaveClass("sr-only");
  });
});
