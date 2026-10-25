import { describe, it, expect } from "vitest";
import { navGroupsFor } from "./nav";
import { breadcrumbsForPath } from "./breadcrumbs";
import { dismissAnnouncement, isAnnouncementDismissed, isDismissed, markDismissed } from "./announcement";
import { parseCollapsed } from "./useSidebarCollapsed";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("navGroupsFor", () => {
  it("has no admin group for a student, and the main items in order", () => {
    const groups = navGroupsFor(false);
    expect(groups.map((g) => g.id)).toEqual(["main", "build", "you"]);
    expect(groups[0]!.label).toBeNull();
    // Custom processes and the leaderboard are search-only: reached from My tracks and the Profile score card.
    expect(groups[0]!.items.map((i) => i.label)).toEqual(["Home", "Companies", "My tracks", "Interviews"]);
    expect(groups[1]!.items.map((i) => i.label)).toEqual(["Share experience"]);
    expect(groups[2]!.items.map((i) => i.label)).toEqual(["Profile", "Connections"]);
  });

  it("adds the admin group last for admins", () => {
    const last = navGroupsFor(true).at(-1)!;
    expect(last.id).toBe("admin");
    expect(last.items.map((i) => i.label)).toContain("Validation controls");
    expect(last.items.map((i) => i.label)).toContain("Intelligence");
  });
});

describe("breadcrumbsForPath", () => {
  it("builds company and role crumbs; the company links only when its slug is known", () => {
    expect(breadcrumbsForPath("/jobs/abc", { company: "Meesho", role: "SDE I" })).toEqual([
      { label: "Companies", href: "/jobs" },
      { label: "Meesho" },
      { label: "SDE I" },
    ]);
    expect(breadcrumbsForPath("/jobs/abc", { company: "Meesho", companySlug: "meesho", role: "SDE I" })[1]).toEqual({
      label: "Meesho",
      href: "/jobs/c/meesho",
    });
  });

  it("falls back to generic names while the page's data is loading", () => {
    expect(breadcrumbsForPath("/jobs/abc").map((c) => c.label)).toEqual(["Companies", "Company", "Role"]);
    expect(breadcrumbsForPath("/jobs/c/meesho").map((c) => c.label)).toEqual(["Companies", "Company"]);
    expect(breadcrumbsForPath("/loops/x").map((c) => c.label)).toEqual(["My tracks", "Track"]);
    expect(breadcrumbsForPath("/processes/x", { process: "My loop" }).map((c) => c.label)).toEqual(["Custom processes", "My loop"]);
  });

  it("labels interview screens and settings tabs", () => {
    expect(breadcrumbsForPath("/interviews/x/report").map((c) => c.label)).toEqual(["Interviews", "Interview", "Report"]);
    expect(breadcrumbsForPath("/interviews/x").map((c) => c.label)).toEqual(["Interviews", "Interview"]);
    expect(breadcrumbsForPath("/settings/privacy").map((c) => c.label)).toEqual(["Settings", "Privacy & data"]);
    expect(breadcrumbsForPath("/dashboard")).toEqual([{ label: "Home" }]);
  });

  it("never gives the last crumb an href, and gives an unknown path one crumb", () => {
    for (const path of ["/jobs/a", "/loops/a", "/interviews/a/report", "/settings/account", "/dashboard"]) {
      expect(breadcrumbsForPath(path).at(-1)!.href).toBeUndefined();
    }
    expect(breadcrumbsForPath("/nowhere")).toHaveLength(1);
  });
});

describe("announcement dismissal", () => {
  it("counts a throwing or garbage store as not dismissed", () => {
    expect(isAnnouncementDismissed("a", throwing)).toBe(false);
    expect(isAnnouncementDismissed("a", { getItem: () => "garbage" })).toBe(false);
    expect(isAnnouncementDismissed("a", { getItem: () => null })).toBe(false);
  });

  it("remembers a dismissal per announcement id", () => {
    const mem = memory();
    dismissAnnouncement("a", mem);
    expect(isAnnouncementDismissed("a", mem)).toBe(true);
    expect(isAnnouncementDismissed("b", mem)).toBe(false);
  });

  it("does not throw when it cannot store", () => {
    expect(() => dismissAnnouncement("a", throwing)).not.toThrow();
    expect(() => markDismissed("iq.invite.dismissed", "1", throwing)).not.toThrow();
    expect(isDismissed("iq.invite.dismissed", "1", throwing)).toBe(false);
  });
});

describe("parseCollapsed", () => {
  it("is collapsed only for the exact value 1", () => {
    expect(parseCollapsed("1")).toBe(true);
    for (const raw of ["0", "yes", "true", "", null]) expect(parseCollapsed(raw)).toBe(false);
  });
});
