import { InvalidArgumentError } from "../lib/errors.js";

/** Canonical wire/persistence values shared by profiles, catalogue, processes and scoring. */
export const ENGINEERING_LEVELS = ["intern", "fresher", "sde1", "sde2", "sde3", "staff", "principal", "distinguished"] as const;
export type EngineeringLevel = (typeof ENGINEERING_LEVELS)[number];

/**
 * Typical years of experience per level ([min, max], null max = open-ended). Not any company's
 * requirement: practice templates show it as "typical for level", and JD fit uses it when a JD lists no range.
 */
export const LEVEL_EXPERIENCE_YEARS: Readonly<Record<EngineeringLevel, readonly [number, number | null]>> = {
  intern: [0, 0], fresher: [0, 1], sde1: [0, 2], sde2: [2, 5], sde3: [5, 8], staff: [8, 12], principal: [12, 16], distinguished: [15, null],
};

export function isEngineeringLevel(value: unknown): value is EngineeringLevel {
  return typeof value === "string" && (ENGINEERING_LEVELS as readonly string[]).includes(value);
}

/** New writes accept enum values only; arbitrary seniority descriptions are not levels. */
export function parseEngineeringLevel(value: unknown): EngineeringLevel {
  if (!isEngineeringLevel(value)) throw new InvalidArgumentError(`level must be one of: ${ENGINEERING_LEVELS.join(", ")}`);
  return value;
}

/** Read compatibility only. Never guess an unknown saved level or rewrite booked identities. */
export function normalizeLegacyLevel(value: unknown): EngineeringLevel | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, EngineeringLevel> = {
    intern: "intern", internship: "intern", fresher: "fresher", sde0: "fresher", newgrad: "fresher", newgraduate: "fresher",
    sde1: "sde1", sdei: "sde1", junior: "sde1", sde2: "sde2", sdeii: "sde2", sde3: "sde3", sdeiii: "sde3", senior: "sde3",
    staff: "staff", principal: "principal", principle: "principal", distinguished: "distinguished",
  };
  return Object.hasOwn(aliases, key) ? aliases[key]! : null;
}

export function engineeringLevelView(value: unknown): { level: EngineeringLevel | null; legacyLevel: string | null } {
  const level = normalizeLegacyLevel(value);
  return { level, legacyLevel: level === null && typeof value === "string" && value.trim() ? value : null };
}
