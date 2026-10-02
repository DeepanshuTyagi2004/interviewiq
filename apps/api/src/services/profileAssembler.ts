import type { ProfileFragmentDoc } from "../db/mongo/client.js";
import { asInt, asString, isObject, items, path } from "../lib/json.js";

export interface NotableItem {
  text: string;
  source: string;
}

/**
 * A most-used skill. `evidence` keeps the cross-source attribution (hard rule — every skill
 * carries evidence); `source` lets the UI show a source icon.
 */
export interface SkillItem {
  skill: string;
  evidence: string;
  source: string;
}

export interface Bands {
  notable: NotableItem[];
  mostUsedSkills: SkillItem[];
}

/** A GitHub language below this byte-share % is "trace" — excluded from most-used skills. */
const RELEVANT_LANGUAGE_PCT = 5;
/** A LeetCode topic counts as a skill only when solved at least this many times. */
const LEETCODE_TOPIC_MIN_SOLVES = 5;

const formatInt = (n: number) => n.toLocaleString("en-US");

/**
 * Produces DESCRIPTIVE (never scored/ranked) profile bands from fragments — the rule-based
 * stand-in until the synthesis service replaces it.
 */
export function assembleProfileBands(fragments: ProfileFragmentDoc[]): Bands {
  const notable: NotableItem[] = [];
  const skills: SkillItem[] = [];

  const g = fragments.find((f) => f.source === "GITHUB")?.data;
  if (g) {
    const lastYear = asInt(path(g, "contributions", "lastYear"), 0);
    if (lastYear > 0) notable.push({ text: `${formatInt(lastYear)} GitHub contributions in the last year`, source: "GITHUB" });
    const externalPRs = asInt(g.externalPRs, 0);
    if (externalPRs > 0) {
      notable.push({ text: `${externalPRs} external pull request contributions to other projects`, source: "GITHUB" });
    }

    // most-used skills from language share; trace languages are dropped. No cap.
    for (const lang of items(g.languages)) {
      const name = asString(path(lang, "name"), "");
      const pct = asInt(path(lang, "pct"), 0);
      if (name !== "" && pct >= RELEVANT_LANGUAGE_PCT) skills.push({ skill: name, evidence: `GitHub ${pct}%`, source: "GITHUB" });
    }
  }

  const lc = fragments.find((f) => f.source === "LEETCODE")?.data;
  if (lc) {
    const solved = lc.solved;
    const total = asInt(path(solved, "total"), 0);
    if (total > 0) {
      const easy = asInt(path(solved, "easy"), 0);
      const medium = asInt(path(solved, "medium"), 0);
      const hard = asInt(path(solved, "hard"), 0);
      notable.push({
        text: `${formatInt(total)} LeetCode problems solved (${easy} Easy, ${medium} Medium, ${hard} Hard)`,
        source: "LEETCODE",
      });
    }

    // Contest activity, described — never used to rank/grade the user.
    const contest = lc.contest;
    if (isObject(contest)) {
      const attended = asInt(contest.attended, 0);
      const rating = asInt(contest.rating, 0);
      if (attended > 0) {
        let text = `Competed in ${attended} LeetCode contest${attended === 1 ? "" : "s"}`;
        if (rating > 0) text += ` (rating ${rating})`;
        notable.push({ text, source: "LEETCODE" });
      }
    }

    const preferredLanguage = asString(path(lc, "recentActivity", "preferredLanguage"), "");
    if (preferredLanguage !== "") {
      skills.push({ skill: preferredLanguage, evidence: "LeetCode preferred (recent submissions)", source: "LEETCODE" });
    }

    // A topic is a skill when solved at least LEETCODE_TOPIC_MIN_SOLVES times (byTopic is pre-sorted).
    for (const t of items(lc.byTopic)) {
      const topic = asString(path(t, "topic"), "");
      const count = asInt(path(t, "count"), 0);
      if (topic !== "" && count >= LEETCODE_TOPIC_MIN_SOLVES) {
        skills.push({ skill: topic, evidence: `LeetCode: ${count} solved`, source: "LEETCODE" });
      }
    }
  }

  return { notable, mostUsedSkills: skills };
}
