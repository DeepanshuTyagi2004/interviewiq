import { describe, expect, it } from "vitest";
import { redactProperties, redactUrl } from "./redact";

describe("redactUrl", () => {
  it("hides one-time tokens in query strings", () => {
    expect(redactUrl("https://app.test/reset-password?token=abc123")).toBe("https://app.test/reset-password?token=[redacted]");
    expect(redactUrl("/verify-email?x=1&token=abc#top")).toBe("/verify-email?x=1&token=[redacted]#top");
    expect(redactUrl("/jobs?company=meesho")).toBe("/jobs?company=meesho");
  });

  it("redacts every string property", () => {
    expect(redactProperties({ $current_url: "/reset-password?token=t", n: 1 })).toEqual({
      $current_url: "/reset-password?token=[redacted]",
      n: 1,
    });
  });
});
