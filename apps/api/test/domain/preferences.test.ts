import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, parsePreferencesPatch, resolvePreferences, toSetPaths } from "../../src/domain/preferences.js";
import { BadRequestError } from "../../src/lib/errors.js";

describe("resolvePreferences", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(resolvePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it("overlays valid stored values and keeps the defaults for the rest", () => {
    const r = resolvePreferences({ interview: { pace: "faster" }, notifications: { email: { weeklyDigest: false } } });
    expect(r.interview.pace).toBe("faster");
    expect(r.interview.voice).toBe("neutral");
    expect(r.notifications.email.weeklyDigest).toBe(false);
    expect(r.notifications.email.debriefReady).toBe(true);
  });

  it("falls back per leaf for stale or invalid stored values and drops unknown keys", () => {
    const r = resolvePreferences({
      _id: "u1",
      updatedAt: new Date(),
      interview: { voice: "robotic", legacy: 1 },
      locale: { timezone: "Mars/Olympus" },
    });
    expect(r.interview.voice).toBe("neutral");
    expect(r.locale.timezone).toBeNull();
    expect(r).not.toHaveProperty("_id");
    expect(r).not.toHaveProperty("updatedAt");
    expect(r.interview).not.toHaveProperty("legacy");
  });
});

describe("parsePreferencesPatch", () => {
  it("accepts partial sections, including timezone null (automatic)", () => {
    expect(parsePreferencesPatch({ locale: { timezone: null } })).toEqual({ locale: { timezone: null } });
    expect(parsePreferencesPatch({ locale: { timezone: "Asia/Kolkata" }, privacy: { shareWithCollege: true } })).toEqual({
      locale: { timezone: "Asia/Kolkata" },
      privacy: { shareWithCollege: true },
    });
    expect(parsePreferencesPatch({})).toEqual({});
  });

  it.each([
    [{ interview: { pace: "warp" } }, "interview.pace"],
    [{ interview: { legacy: true } }, "interview"],
    [{ unknownSection: {} }, ""],
    [{ locale: { timezone: "Mars/Olympus" } }, "locale.timezone"],
    [{ notifications: { email: { weeklyDigest: "yes" } } }, "notifications.email.weeklyDigest"],
    ["not an object", ""],
  ])("rejects %j as invalid_preferences", (body, path) => {
    let caught: unknown;
    try {
      parsePreferencesPatch(body);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestError);
    expect((caught as BadRequestError).code).toBe("invalid_preferences");
    if (path) expect((caught as BadRequestError).message).toContain(path);
  });
});

describe("toSetPaths", () => {
  it("flattens a patch into dotted $set paths, keeping null leaves", () => {
    expect(
      toSetPaths({
        locale: { timezone: null, weekStart: "sunday" },
        notifications: { emailPaused: true, email: { productUpdates: true } },
      }),
    ).toEqual({
      "locale.timezone": null,
      "locale.weekStart": "sunday",
      "notifications.emailPaused": true,
      "notifications.email.productUpdates": true,
    });
  });

  it("is empty for an empty patch", () => {
    expect(toSetPaths({})).toEqual({});
  });
});
