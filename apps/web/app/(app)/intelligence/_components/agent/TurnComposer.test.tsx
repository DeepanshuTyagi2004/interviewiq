import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TurnComposer } from "./TurnComposer";

describe("TurnComposer", () => {
  it("disables the Send button unless status is awaiting_input", () => {
    const { rerender } = render(
      <TurnComposer status="running" onSubmit={() => {}} onSilence={() => {}} onEnd={() => {}} />
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();

    rerender(
      <TurnComposer status="awaiting_input" onSubmit={() => {}} onSilence={() => {}} onEnd={() => {}} />
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeEnabled();
  });
});
