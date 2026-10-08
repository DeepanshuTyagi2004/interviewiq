import { expect, it } from "vitest";
import { ApiFetchError } from "@/lib/api-client/client";
import { linkedInError } from "./errors";

it("points non-LinkedIn and unreadable files back to the Save to PDF steps", () => {
  expect(linkedInError(new ApiFetchError(422, "linkedin_pdf_unrecognized", "x"))).toContain("Resume row");
  expect(linkedInError(new ApiFetchError(422, "linkedin_pdf_unreadable", "x"))).toContain("Save to PDF");
  expect(linkedInError(new ApiFetchError(413, "linkedin_pdf_too_large", "x"))).toContain("5 MB");
});

it("distinguishes cancellation and draft limits from stale profile conflicts", () => {
  expect(linkedInError(new ApiFetchError(409, "linkedin_import_cancelled", "cancelled"))).toContain("disconnected");
  expect(linkedInError(new ApiFetchError(409, "linkedin_import_cancelled", "cancelled"))).not.toContain("profile changed");
  expect(linkedInError(new ApiFetchError(409, "linkedin_profile_changed", "changed"))).toContain("profile changed during review");
  expect(linkedInError(new ApiFetchError(429, "linkedin_draft_limit", "limit"))).toContain("three unconfirmed imports");
});
