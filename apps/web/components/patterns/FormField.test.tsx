import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("renders the label and the control slot", () => {
    render(
      <FormField label="Email">
        <input aria-label="email-input" />
      </FormField>,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("email-input")).toBeInTheDocument();
  });

  it("shows the error message and not the hint when error is set", () => {
    render(
      <FormField label="Email" hint="We never share it" error="Required">
        <input aria-label="email-input" />
      </FormField>,
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.queryByText("We never share it")).not.toBeInTheDocument();
  });

  it("shows the hint when there is no error", () => {
    render(
      <FormField label="Email" hint="We never share it">
        <input aria-label="email-input" />
      </FormField>,
    );
    expect(screen.getByText("We never share it")).toBeInTheDocument();
  });
});
