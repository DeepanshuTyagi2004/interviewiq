import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { parseSkills, SkillsInput } from "./SkillsInput";

describe("parseSkills", () => {
  it("trims, drops empties and de-duplicates case-insensitively", () => {
    expect(parseSkills(" Go, python ,, Python, SQL ")).toEqual(["Go", "python", "SQL"]);
    expect(parseSkills("")).toEqual([]);
  });
});

function Harness({ initial, onChange }: { initial: string; onChange: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SkillsInput
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe("SkillsInput", () => {
  it("adds on Enter, removes on click, and pops the last chip on Backspace", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="Go, Python" onChange={onChange} />);

    await user.type(screen.getByLabelText("Add a skill"), "Kafka{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("Go, Python, Kafka");

    await user.click(screen.getByRole("button", { name: "Remove Python" }));
    expect(onChange).toHaveBeenLastCalledWith("Go, Kafka");

    await user.type(screen.getByLabelText("Add a skill"), "{Backspace}");
    expect(onChange).toHaveBeenLastCalledWith("Go");
  });
});
