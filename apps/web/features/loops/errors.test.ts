import { describe, expect, it } from "vitest";
import { ApiFetchError } from "@/lib/api-client/errors";
import { bookingError } from "./errors";

describe("bookingError", () => {
  it("maps interview_access_required to the access message", () => {
    const err = new ApiFetchError(403, "interview_access_required", "Interview access has not been granted to your account yet. Ask an admin.");
    expect(bookingError(err)).toBe("Mock interviews are invite-only during the beta");
  });
});
