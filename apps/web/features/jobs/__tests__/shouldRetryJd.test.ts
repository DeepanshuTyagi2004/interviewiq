import { describe, expect, it } from "vitest";
import { ApiFetchError } from "@/lib/api-client/errors";
import { shouldRetryJd } from "../hooks";

describe("shouldRetryJd", () => {
  it("fails fast on client errors", () => {
    expect(shouldRetryJd(0, new ApiFetchError(404, "jd_not_found", "x"))).toBe(false);
    expect(shouldRetryJd(0, new ApiFetchError(400, "invalid_request", "x"))).toBe(false);
  });

  it("retries server and network errors up to three times", () => {
    expect(shouldRetryJd(0, new ApiFetchError(502, "upstream", "x"))).toBe(true);
    expect(shouldRetryJd(2, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryJd(3, new TypeError("Failed to fetch"))).toBe(false);
  });
});
