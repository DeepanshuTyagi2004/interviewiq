import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { HighlightsEditor } from "./HighlightsEditor";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <HighlightsEditor id="hl" value={value} onChange={setValue} />;
}

const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;

describe("HighlightsEditor", () => {
  it("bolds the selection from the toolbar and with the keyboard shortcut", async () => {
    const user = userEvent.setup();
    render(<Harness initial="Cut latency by 42%" />);
    const el = textarea();
    el.focus();
    el.setSelectionRange(15, 18);
    await user.click(screen.getByRole("button", { name: /^Bold/ }));
    expect(el.value).toBe("Cut latency by **42%**");

    el.setSelectionRange(4, 11);
    await user.keyboard("{Control>}b{/Control}");
    expect(el.value).toBe("Cut **latency** by **42%**");
  });

  it("turns lines into a list, continues it on Enter and nests with Tab", async () => {
    const user = userEvent.setup();
    render(<Harness initial="First point" />);
    const el = textarea();
    el.focus();
    el.setSelectionRange(0, el.value.length);
    await user.click(screen.getByRole("button", { name: "Bulleted list" }));
    expect(el.value).toBe("- First point");

    el.setSelectionRange(el.value.length, el.value.length);
    await user.keyboard("{Enter}Sub point{Tab}");
    expect(el.value).toBe("- First point\n  - Sub point");
  });

  it("leaves Tab alone on a plain line so focus can move on", async () => {
    const user = userEvent.setup();
    render(<Harness initial="Plain line" />);
    const el = textarea();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    await user.keyboard("{Tab}");
    expect(el.value).toBe("Plain line");
    expect(el).not.toHaveFocus();
  });

  it("previews the formatted lines and disables the toolbar while previewing", async () => {
    const user = userEvent.setup();
    render(<Harness initial={"- Built a **voice agent**\n  - Nested"} />);
    await user.click(screen.getByRole("button", { name: "preview" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("voice agent").tagName).toBe("STRONG");
    expect(screen.getByRole("button", { name: /^Bold/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "write" }));
    expect(textarea().value).toBe("- Built a **voice agent**\n  - Nested");
  });
});
