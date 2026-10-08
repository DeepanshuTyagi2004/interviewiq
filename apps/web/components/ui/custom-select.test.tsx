import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomSelect } from "./custom-select";

const options = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta", disabled: true }, { value: "c", label: "Charlie" }];

describe("CustomSelect", () => {
  it("supports keyboard navigation, skips disabled choices, and commits once", async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<CustomSelect label="Round type" value="a" options={options} onValueChange={change} name="type" />);
    const trigger = screen.getByRole("combobox", { name: "Round type" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox", { name: "Round type" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith("c");
    expect(trigger).toHaveFocus();
  });

  it("supports typeahead and escape without committing", async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<CustomSelect label="Choice" value="a" options={options} onValueChange={change} />);
    await user.click(screen.getByRole("combobox", { name: "Choice" }));
    await user.keyboard("c{Escape}");
    expect(change).not.toHaveBeenCalled();
    await user.click(screen.getByRole("combobox", { name: "Choice" }));
    await user.keyboard("c{Enter}");
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith("c");
  });

  it("does not open read-only or disabled controls", async () => {
    const user = userEvent.setup();
    render(<><CustomSelect label="Readonly" value="a" options={options} onValueChange={vi.fn()} readOnly /><CustomSelect label="Disabled" value="a" options={options} onValueChange={vi.fn()} disabled /></>);
    await user.click(screen.getByRole("combobox", { name: "Readonly" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Disabled" })).toBeDisabled();
  });
});
