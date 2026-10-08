import { createHash } from "node:crypto";
import type { EngineeringLevel } from "../../src/domain/engineeringLevels.js";

export type RoundType = "dsa" | "system-design" | "lld" | "behavioural" | "hiring-manager";

export interface RoundIn {
  name: string;
  type: RoundType;
  minutes: number;
  difficulty: "easy" | "medium" | "hard";
  topics: string[];
  /** Only questions/problems that candidates publicly reported for this company. */
  questions?: string[];
  guidance: string;
  src: string[];
}

export interface RoleIn {
  /** Stable within the company; seeds the deterministic role/round UUIDs so re-runs update in place. */
  key: string;
  title: string;
  level: EngineeringLevel;
  spec: string | null;
  description: string;
  stack: string[];
  yoe: [number, number];
  /** Total CTC in LPA, as reported by public salary sources; approximate. null = no source found. */
  ctc: [number, number] | null;
  src: string[];
  rounds: RoundIn[];
}

export interface QuoteIn {
  text: string;
  sourceUrl: string;
  sourceName: string;
  date: string | null;
}

export interface CompanyIn {
  name: string;
  slug: string;
  tier: 1 | 2 | 3 | 4;
  tierRationale: string;
  hq: string;
  /** companies.company_size (display string). */
  size: string;
  website: string;
  aliases: string[];
  sector: "fintech" | "e-commerce" | "saas" | "it-services" | "consumer-internet" | "enterprise-software" | "edtech" | "logistics" | "other";
  businessModel: "product" | "service" | "hybrid";
  headcountBand: string;
  revenueBand: string;
  fundingStage: "public" | "late-stage" | "growth" | "early" | "bootstrapped" | "subsidiary";
  /** Work-life balance, 0-5, only where a source states that specific category; otherwise null. */
  wlbRating: number | null;
  wlbReviewCount: number | null;
  reviewSummary: string;
  reviewQuotes: QuoteIn[];
  overview: string;
  culture: string;
  benefits: string;
  src: string[];
  roles: RoleIn[];
}

/** Deterministic UUID (v5-shaped) so role/round ids are stable across seed runs. */
export function rid(scope: string, key: string): string {
  const hex = createHash("sha256").update(`${scope}\0${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
