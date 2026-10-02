import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormattedLines, parseLines } from "./FormattedLines";

const LINES = [
  "**AI Sales Agent**",
  "- Built a **voice agent** for *10k* calls",
  "  - Added a **barge-in** detector",
  "- Cut latency by **42%**",
  "**SFA Apps**",
  "1. First",
  "2. Second",
];

describe("parseLines", () => {
  it("groups paragraphs, bullets, nested bullets and numbered lists", () => {
    const blocks = parseLines(LINES);
    expect(blocks.map((b) => b.kind)).toEqual(["p", "list", "p", "list"]);
    const bullets = blocks[1] as Extract<(typeof blocks)[number], { kind: "list" }>;
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    expect(bullets.items[0].children[0].items[0].text).toBe("Added a **barge-in** detector");
    expect((blocks[3] as typeof bullets).ordered).toBe(true);
  });

  it("treats an indented first line as top-level and ignores blank lines", () => {
    const blocks = parseLines(["   ", "  - lonely nested"]);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(1);
  });

  it("renders marker-less lines (the older one-per-line format) as bullets", () => {
    const blocks = parseLines(["Built X", "", "Shipped **Y**"]);
    expect(blocks).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          { text: "Built X", children: [] },
          { text: "Shipped **Y**", children: [] },
        ],
      },
    ]);
  });
});

describe("FormattedLines", () => {
  it("renders bold, italic and nested lists", () => {
    const { container } = render(<FormattedLines lines={LINES} />);
    expect(screen.getByText("voice agent").tagName).toBe("STRONG");
    expect(screen.getByText("10k").tagName).toBe("EM");
    expect(container.querySelectorAll("ul ul li")).toHaveLength(1);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("never interprets HTML in the text", () => {
    const { container } = render(<FormattedLines lines={['- <img src=x onerror="alert(1)"> **hi**']} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("renders nothing for no lines", () => {
    const { container } = render(<FormattedLines lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
