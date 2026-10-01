import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OAuthStateService } from "../../src/integrations/github/oauthState.js";
import { InvalidArgumentError } from "../../src/lib/errors.js";

/** OAuthStateService (no Java test existed) — behaviour mirrors the Java OAuthStateService. */

const SECRET = "test-jwt-secret-that-is-at-least-32-bytes-long!!";
const T0 = 1_700_000_000; // epoch seconds
const at = (epochSeconds: number) => () => new Date(epochSeconds * 1000);
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/**
 * State issued by the Java OAuthStateService's exact HMAC/base64 code with the same secret for
 * userId 3f2504e0-4f89-11d3-9a0c-0305e82c3301 at epoch 1700000000.
 */
const JAVA_STATE =
  "M2YyNTA0ZTAtNGY4OS0xMWQzLTlhMGMtMDMwNWU4MmMzMzAxOjE3MDAwMDAwMDA6eXJaaEx1U0R0bE1TdU04Tks5Z2NxZmtzNmF1aGdzSTBsbk52UEVfajdIQQ";
const JAVA_USER = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function verifyError(svc: OAuthStateService, state: string): InvalidArgumentError {
  try {
    svc.verify(state);
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidArgumentError);
    return err as InvalidArgumentError;
  }
  throw new Error("expected verify to throw");
}

describe("OAuthStateService", () => {
  it("issue/verify round-trips the user id", () => {
    const svc = new OAuthStateService(SECRET, at(T0));
    const userId = randomUUID();
    expect(svc.verify(svc.issue(userId))).toBe(userId);
  });

  it("state is unpadded base64url of '{userId}:{epochSeconds}:{hmac}' using the injected clock", () => {
    const userId = randomUUID();
    const state = new OAuthStateService(SECRET, at(T0)).issue(userId);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/); // no '+', '/', '='
    const [u, ts, sig] = unb64url(state).split(":");
    expect(u).toBe(userId);
    expect(ts).toBe(String(T0));
    expect(sig).toBe(createHmac("sha256", SECRET).update(`${userId}:${T0}`).digest("base64url"));
  });

  it("is byte-compatible with the Java implementation (issue produces, verify accepts, the Java vector)", () => {
    const svc = new OAuthStateService(SECRET, at(T0));
    expect(svc.issue(JAVA_USER)).toBe(JAVA_STATE);
    expect(new OAuthStateService(SECRET, at(T0 + 30)).verify(JAVA_STATE)).toBe(JAVA_USER);
  });

  it("returns the canonical lower-case UUID (Java UUID.fromString(..).toString())", () => {
    const upper = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";
    const svc = new OAuthStateService(SECRET, at(T0));
    expect(svc.verify(svc.issue(upper))).toBe(upper.toLowerCase());
  });

  describe("expiry (MAX_AGE = 10 minutes)", () => {
    const state = new OAuthStateService(SECRET, at(T0)).issue(JAVA_USER);

    it("accepts a state exactly 10 minutes old", () => {
      expect(new OAuthStateService(SECRET, at(T0 + 600)).verify(state)).toBe(JAVA_USER);
    });

    it("rejects a state older than 10 minutes", () => {
      expect(verifyError(new OAuthStateService(SECRET, at(T0 + 601)), state).message).toBe("OAuth state expired");
      expect(verifyError(new OAuthStateService(SECRET, at(T0 + 86_400)), JAVA_STATE).message).toBe("OAuth state expired");
    });

    it("accepts a state stamped slightly in the future (clock skew), like Java", () => {
      expect(new OAuthStateService(SECRET, at(T0 - 5)).verify(state)).toBe(JAVA_USER);
    });
  });

  describe("tampering", () => {
    const svc = new OAuthStateService(SECRET, at(T0));
    const [user, ts, sig] = unb64url(svc.issue(JAVA_USER)).split(":") as [string, string, string];

    it("rejects a modified signature", () => {
      const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
      expect(verifyError(svc, b64url(`${user}:${ts}:${flipped}`)).message).toBe("OAuth state signature mismatch");
      expect(verifyError(svc, b64url(`${user}:${ts}:`)).message).toMatch(/signature mismatch|Malformed/);
    });

    it("rejects a swapped user id (signature no longer matches)", () => {
      expect(verifyError(svc, b64url(`${randomUUID()}:${ts}:${sig}`)).message).toBe("OAuth state signature mismatch");
    });

    it("rejects a pushed-forward timestamp (can't extend a state's life)", () => {
      expect(verifyError(svc, b64url(`${user}:${T0 + 3600}:${sig}`)).message).toBe("OAuth state signature mismatch");
    });

    it("rejects a state signed with a different secret", () => {
      const forged = new OAuthStateService("some-other-secret-that-is-also-long-enough!!", at(T0)).issue(JAVA_USER);
      expect(verifyError(svc, forged).message).toBe("OAuth state signature mismatch");
    });
  });

  describe("malformed input", () => {
    const svc = new OAuthStateService(SECRET, at(T0));

    it.each([
      ["empty", ""],
      ["not base64 of a triple", "not-a-state"],
      ["two parts", b64url(`${JAVA_USER}:${T0}`)],
      ["four parts", b64url(`${JAVA_USER}:${T0}:sig:extra`)],
    ])("rejects %s", (_label, state) => {
      expect(verifyError(svc, state).message).toBe("Malformed OAuth state");
    });

    it("rejects a correctly signed payload whose user id is not a UUID", () => {
      const state = svc.issue("not-a-uuid");
      expect(() => svc.verify(state)).toThrow(InvalidArgumentError);
    });

    it("rejects a correctly signed payload whose timestamp is not an integer", () => {
      const payload = `${JAVA_USER}:soon`;
      const state = b64url(`${payload}:${createHmac("sha256", SECRET).update(payload).digest("base64url")}`);
      expect(() => svc.verify(state)).toThrow(InvalidArgumentError);
    });
  });
});
