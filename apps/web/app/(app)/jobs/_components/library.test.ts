import { describe, expect, it } from "vitest";
import type { DataAvailability, JdSummary, JobCompany } from "@/features/jobs";
import {
  buildCompanyEntries,
  cardCta,
  depthOf,
  filterLibrary,
  groupByLevel,
  levelLabel,
  researchedLine,
  rolesLine,
  specializationLabel,
  specializationsOf,
} from "./library";

function jd(id: string, company: string, availability: DataAvailability, partial: Partial<JdSummary> = {}): JdSummary {
  return {
    id,
    company,
    companyName: company.charAt(0).toUpperCase() + company.slice(1),
    role: "software-engineer",
    level: "fresher",
    title: `Role ${id}`,
    specialization: "backend",
    dataConfidence: null,
    dataAvailability: availability,
    ...partial,
  };
}

function company(slug: string, name: string): JobCompany {
  return { id: slug, slug, name, tier: null, logoUrl: null, headquarterLocation: null, companySize: null };
}

describe("labels", () => {
  it("maps known levels and passes unknown ones through", () => {
    expect(levelLabel("sde1")).toBe("SDE I");
    expect(levelLabel("fresher")).toBe("Fresher");
    expect(levelLabel("staff")).toBe("staff");
  });

  it("humanizes specializations", () => {
    expect(specializationLabel("data-engineering")).toBe("Data engineering");
    expect(specializationLabel("ml")).toBe("ML");
    expect(specializationLabel("android")).toBe("Android");
  });
});

describe("depthOf", () => {
  it("maps real data confidence onto the design's 5-step scale", () => {
    expect(depthOf("rich")).toEqual({ bars: 5, label: "High" });
    expect(depthOf("available")).toEqual({ bars: 3, label: "Medium" });
    expect(depthOf("limited")).toEqual({ bars: 2, label: "Low" });
    expect(depthOf("none")).toEqual({ bars: 0, label: "None yet" });
  });
});

describe("buildCompanyEntries", () => {
  const jds = [
    jd("a", "meesho", "limited"),
    jd("b", "meesho", "rich"),
    jd("c", "flipkart", "limited"),
    jd("d", "orphan", "available", { companyName: "Orphan Co" }),
  ];

  it("derives live status and best availability from the roles only", () => {
    const entries = buildCompanyEntries([company("meesho", "Meesho"), company("flipkart", "Flipkart")], jds);
    const meesho = entries.find((e) => e.slug === "meesho")!;
    expect(meesho.live).toBe(true);
    expect(meesho.availability).toBe("rich");
    expect(meesho.jds.map((j) => j.id)).toEqual(["b", "a"]);
    expect(entries.find((e) => e.slug === "flipkart")!.live).toBe(false);
  });

  it("keeps companies with no roles and adds companies known only from a JD", () => {
    const entries = buildCompanyEntries([company("razorpay", "Razorpay")], jds);
    expect(entries.find((e) => e.slug === "razorpay")).toMatchObject({ live: false, availability: "none", jds: [] });
    expect(entries.find((e) => e.slug === "orphan")?.name).toBe("Orphan Co");
  });

  it("sorts live companies first, then by role count", () => {
    const entries = buildCompanyEntries([company("razorpay", "Razorpay")], jds);
    expect(entries.map((e) => e.slug)).toEqual(["meesho", "orphan", "flipkart", "razorpay"]);
  });

  it("handles missing data", () => {
    expect(buildCompanyEntries(undefined, undefined)).toEqual([]);
  });
});

describe("filterLibrary", () => {
  const entries = buildCompanyEntries(
    [company("meesho", "Meesho"), company("flipkart", "Flipkart")],
    [
      jd("a", "meesho", "rich", { title: "SDE I — Backend" }),
      jd("b", "meesho", "none", { title: "SDE I — Android", specialization: "android" }),
      jd("c", "flipkart", "limited", { title: "Data Engineer I", specialization: "data-engineering" }),
    ],
  );

  it("filters by live / researching", () => {
    expect(filterLibrary(entries, { query: "", status: "live" }).map((m) => m.entry.slug)).toEqual(["meesho"]);
    expect(filterLibrary(entries, { query: "", status: "researching" }).map((m) => m.entry.slug)).toEqual(["flipkart"]);
  });

  it("lists every role of a company matched by name", () => {
    const [m] = filterLibrary(entries, { query: "mees", status: "all" });
    expect(m.jds.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("lists only the matching roles when the query hits a role title or specialization", () => {
    expect(filterLibrary(entries, { query: "android", status: "all" }).map((m) => m.jds.map((j) => j.id))).toEqual([["b"]]);
    expect(filterLibrary(entries, { query: "data engineer", status: "all" }).map((m) => m.entry.slug)).toEqual(["flipkart"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterLibrary(entries, { query: "zepto", status: "all" })).toEqual([]);
  });
});

describe("groupByLevel / specializationsOf", () => {
  const list = [
    jd("a", "x", "none", { level: "sde2" }),
    jd("b", "x", "rich", { level: "fresher", specialization: "android" }),
    jd("c", "x", "limited", { level: "fresher", specialization: null }),
  ];

  it("groups in level order", () => {
    expect(groupByLevel(list).map((g) => [g.label, g.jds.map((j) => j.id)])).toEqual([
      ["Fresher", ["b", "c"]],
      ["SDE II", ["a"]],
    ]);
  });

  it("collects distinct specializations", () => {
    expect(specializationsOf(list)).toEqual(["android", "backend"]);
  });
});

describe("card lines and CTA", () => {
  const entries = buildCompanyEntries(
    [company("one", "One"), company("two", "Two"), company("quiet", "Quiet"), company("solo", "Solo"), company("empty", "Empty")],
    [
      jd("1a", "one", "rich", { title: "SDE I Backend" }),
      jd("1b", "one", "limited"),
      jd("1c", "one", "none"),
      jd("2a", "two", "rich"),
      jd("2b", "two", "available"),
      jd("3a", "quiet", "limited"),
      jd("3b", "quiet", "none"),
      jd("4a", "solo", "none"),
    ],
  );
  const get = (slug: string) => entries.find((e) => e.slug === slug)!;

  it("opens the single live role, as primary", () => {
    expect(cardCta(get("one"))).toMatchObject({ kind: "open", primary: true, jd: { id: "1a" } });
    expect(rolesLine(get("one"))).toBe("3 roles · 1 live");
    expect(researchedLine(get("one"))).toBe("2 of 3 roles researched");
  });

  it("points at the role list when several roles are live", () => {
    expect(cardCta(get("two"))).toEqual({ kind: "roles", count: 2, primary: true });
  });

  it("stays quiet for companies without a live role", () => {
    expect(cardCta(get("quiet"))).toEqual({ kind: "roles", count: 2, primary: false });
    expect(cardCta(get("solo"))).toMatchObject({ kind: "open", primary: false, jd: { id: "4a" } });
    expect(researchedLine(get("solo"))).toBe("Not researched yet");
  });

  it("has no action for a company without roles", () => {
    expect(cardCta(get("empty"))).toEqual({ kind: "none" });
    expect(rolesLine(get("empty"))).toBe("No roles yet");
  });
});
