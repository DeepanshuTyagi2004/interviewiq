import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => ({ status: "unauthenticated" }) }));

import { ApiFetchError } from "@/lib/api-client/errors";
import { authErrorMessage } from "./errors";
import { signUpSchema, resetPasswordSchema } from "./schemas";
import { safeNextPath } from "./useRedirectWhenSignedIn";

describe("authErrorMessage", () => {
  it("maps stable API codes to human copy", () => {
    expect(authErrorMessage(new ApiFetchError(401, "invalid_credentials", "x"))).toBe("Incorrect email or password.");
    expect(authErrorMessage(new ApiFetchError(409, "use_google", "x"))).toMatch(/Continue with Google/);
    expect(authErrorMessage(new ApiFetchError(429, "rate_limited", "x"))).toMatch(/Too many attempts/);
  });

  it("passes validation messages through and falls back otherwise", () => {
    expect(authErrorMessage(new ApiFetchError(400, "invalid_request", "Name is too long"))).toBe("Name is too long");
    expect(authErrorMessage(new TypeError("Failed to fetch"))).toMatch(/Couldn't reach/);
    expect(authErrorMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});

describe("safeNextPath", () => {
  it("only honours same-origin paths", () => {
    expect(safeNextPath("/jobs/123")).toBe("/jobs/123");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});

describe("auth schemas", () => {
  it("requires a real email and an 8+ character password on sign-up", () => {
    expect(signUpSchema.safeParse({ name: "A", email: "nope", password: "12345678" }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: "A", email: "a@b.co", password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: "A", email: "a@b.co", password: "        " }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: "A", email: " a@b.co ", password: "12345678" }).success).toBe(true);
  });

  it("checks the confirmation matches on reset", () => {
    expect(resetPasswordSchema.safeParse({ password: "12345678", confirm: "12345679" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "12345678", confirm: "12345678" }).success).toBe(true);
  });
});
