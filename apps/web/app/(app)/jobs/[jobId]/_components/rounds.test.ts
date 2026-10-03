import { describe, expect, it } from "vitest";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import {
  bookHref,
  isOnlineAssessment,
  roundEvidence,
  roundMeta,
  roundTitle,
  roundTopics,
  toRoundType,
  topicRows,
} from "./rounds";
import { confidenceWord, groupSources } from "./insights";

describe("toRoundType", () => {
  it("maps every brief round type that has a live mock round", () => {
    for (const { value } of ROUND_OPTIONS) expect(toRoundType(value)).toBe(value);
  });

  it("tolerates case, spacing and clear synonyms", () => {
    expect(toRoundType("System Design")).toBe("system-design");
    expect(toRoundType(" DSA ")).toBe("dsa");
    expect(toRoundType("hiring_manager")).toBe("hiring-manager");
    expect(toRoundType("Behavioral")).toBe("behavioural");
    expect(toRoundType("HLD")).toBe("system-design");
    expect(toRoundType("Machine coding")).toBe("lld");
  });

  it("leaves online assessments and ambiguous types unmapped", () => {
    expect(toRoundType("online-assessment")).toBeNull();
    expect(toRoundType("technical")).toBeNull();
    expect(toRoundType("HR")).toBeNull();
    expect(toRoundType(null)).toBeNull();
    expect(toRoundType("")).toBeNull();
  });
});

describe("bookHref", () => {
  it("carries the JD and the mapped round type", () => {
    expect(bookHref("jd-1", "system-design")).toBe("/interviews?jd=jd-1&round=system-design");
  });

  it("falls back to just the JD when the round has no mapping", () => {
    expect(bookHref("jd-1", "online-assessment")).toBe("/interviews?jd=jd-1");
    expect(bookHref("jd-1", undefined)).toBe("/interviews?jd=jd-1");
  });
});

describe("round display", () => {
  it("titles rounds from their type, falling back to the number", () => {
    expect(roundTitle({ type: "lld" }, 0)).toBe("Low-Level Design");
    expect(roundTitle({ type: "online-assessment" }, 0)).toBe("Online Assessment");
    expect(roundTitle({ type: "bar_raiser" }, 0)).toBe("Bar raiser");
    expect(roundTitle({ type: "hr" }, 0)).toBe("HR");
    expect(roundTitle({ type: "hr_screen" }, 0)).toBe("HR screen");
    expect(roundTitle({ round_number: 3 }, 0)).toBe("Round 3");
    expect(roundTitle({}, 1)).toBe("Round 2");
    expect(isOnlineAssessment("OA")).toBe(true);
  });

  it("builds the meta line from format and difficulty only", () => {
    expect(roundMeta({ format: "Live coding · 60 min", difficulty: "Medium" })).toBe("Live coding · 60 min · medium");
    expect(roundMeta({ difficulty: "hard" })).toBe("hard");
    expect(roundMeta({})).toBe("");
  });

  it("reads topics from either brief shape, de-duplicated", () => {
    expect(roundTopics({ dominant_topics: ["Arrays", "Arrays ", "Hashing"] })).toEqual(["Arrays", "Hashing"]);
    expect(roundTopics({ topics: ["Graphs"] })).toEqual(["Graphs"]);
    expect(roundTopics({})).toEqual([]);
  });

  it("describes attestation without scoring", () => {
    expect(roundEvidence({ support_count: 3, source_count_total: 5 })).toBe("Reported in 3 of 5 sources");
    expect(roundEvidence({ consistency: "appears in 4 of 5 experiences" })).toBe("Appears in 4 of 5 experiences");
    expect(roundEvidence({ support_count: 0, source_count_total: 5 })).toBeNull();
    expect(roundEvidence({ provenance: "admin_verified", source_urls: ["https://example.com"], support_count: 3, source_count_total: 5 })).toBe("Admin-verified");
  });

  it("uses manual names and explicit durations without inventing defaults", () => {
    expect(roundTitle({ name: "Architecture deep dive", type: "system-design" }, 0)).toBe("Architecture deep dive");
    expect(roundMeta({ duration_minutes: 75, difficulty: "hard" })).toBe("75 min · hard");
    expect(roundMeta({ duration_minutes: 0 })).toBe("");
  });
});

describe("topicRows", () => {
  it("cross-references dominant topics with the rounds that list them", () => {
    const rows = topicRows({
      dominant_topics: ["Hashing", "Caching", "SQL"],
      rounds: [
        { round_number: 1, dominant_topics: ["hashing", "Arrays"] },
        { round_number: 2, topics: ["Hashing", "Caching"] },
      ],
    });
    expect(rows).toEqual([
      { topic: "Hashing", rounds: [1, 2] },
      { topic: "Caching", rounds: [2] },
      { topic: "SQL", rounds: [] },
    ]);
  });

  it("is empty without a process", () => {
    expect(topicRows(null)).toEqual([]);
  });
});

describe("insights helpers", () => {
  it("groups sources by site with real URL counts", () => {
    const groups = groupSources([
      "https://www.reddit.com/r/developersIndia/a",
      "https://reddit.com/r/developersIndia/b",
      "https://leetcode.com/discuss/1",
      "https://example.org/post",
      "https://leetcode.com/discuss/1",
      "not a url",
    ]);
    expect(groups.map((g) => [g.site, g.urls.length])).toEqual([
      ["Reddit", 2],
      ["example.org", 1],
      ["LeetCode", 1],
      ["not a url", 1],
    ]);
  });

  it("only recognises the brief's confidence levels", () => {
    expect(confidenceWord("HIGH")).toBe("high");
    expect(confidenceWord("unknown")).toBeNull();
    expect(confidenceWord(null)).toBeNull();
  });
});
