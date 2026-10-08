import type { components } from "@/lib/api-client/generated/schema";

export type EngineeringLevel = components["schemas"]["EngineeringLevel"];
export const ENGINEERING_LEVELS = ["intern", "fresher", "sde1", "sde2", "sde3", "staff", "principal", "distinguished"] as const satisfies readonly EngineeringLevel[];
export const ENGINEERING_LEVEL_OPTIONS = [
  { value: "intern", label: "Intern" },
  { value: "fresher", label: "Fresher" },
  { value: "sde1", label: "SDE I" },
  { value: "sde2", label: "SDE II" },
  { value: "sde3", label: "SDE III" },
  { value: "staff", label: "Staff" },
  { value: "principal", label: "Principal" },
  { value: "distinguished", label: "Distinguished" },
] satisfies { value: EngineeringLevel; label: string }[];

export function isEngineeringLevel(value: unknown): value is EngineeringLevel {
  return typeof value === "string" && ENGINEERING_LEVEL_OPTIONS.some((option) => option.value === value);
}

/** Read compatibility only; new writes must use a canonical enum value. */
export function normalizeLegacyLevel(value: unknown): EngineeringLevel | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, EngineeringLevel> = {
    intern: "intern", internship: "intern", fresher: "fresher", sde0: "fresher", newgrad: "fresher", newgraduate: "fresher",
    sde1: "sde1", sdei: "sde1", junior: "sde1", sde2: "sde2", sdeii: "sde2", sde3: "sde3", sdeiii: "sde3", senior: "sde3",
    staff: "staff", principal: "principal", principle: "principal", distinguished: "distinguished",
  };
  return Object.hasOwn(aliases, key) ? aliases[key] : null;
}

export function levelLabel(value: string | null | undefined): string {
  const level = normalizeLegacyLevel(value);
  return ENGINEERING_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? value ?? "Unknown";
}
