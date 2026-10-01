import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { isUniqueViolation, safeErrorMessage } from "../../src/lib/errors.js";

describe("log-safe errors", () => {
  it("never repeats Drizzle's query params (emails, password hashes) in the loggable message", () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "app_user_email_unique"'), { code: "23505" });
    const err = new DrizzleQueryError('insert into "app_user" ...', ["asha@example.com", "scrypt$32768$8$3$salt$hash"], cause);
    expect(err.message).toContain("asha@example.com"); // why this helper exists
    const safe = safeErrorMessage(err);
    expect(safe).toBe('database query failed: duplicate key value violates unique constraint "app_user_email_unique"');
    expect(safe).not.toContain("asha@example.com");
    expect(safe).not.toContain("scrypt$");
    expect(safeErrorMessage(new Error("plain"))).toBe("plain");
  });

  it("detects a unique violation directly or through Drizzle's wrapper", () => {
    const pg = Object.assign(new Error("dup"), { code: "23505" });
    expect(isUniqueViolation(pg)).toBe(true);
    expect(isUniqueViolation(new DrizzleQueryError("q", [], pg))).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
