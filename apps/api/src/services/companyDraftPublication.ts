import { z } from "zod";
import type { companies } from "../db/pg/schema.js";
import { ApiError } from "../lib/errors.js";

/** Company `sector` values a research draft may publish (JD fit maps the specific ones to domains). */
export const COMPANY_SECTORS = [
  "fintech", "e-commerce", "saas", "it-services", "consumer-internet", "enterprise-software",
  "semiconductors", "telecom", "edtech", "healthtech", "gaming", "logistics", "other",
] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const field = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable() }).optional();
const count = z.number().int().min(0).max(2_147_483_647);
const sourceUrl = text(2048).refine((value) => {
  if (!/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}, "must be an absolute http(s) URL without credentials");

const quote = z.object({
  text: text(300),
  sourceUrl,
  sourceName: text(255).nullable().optional().default(null),
  date: text(64).nullable().optional().default(null),
});

const publication = z.object({
  identity: z.object({
    name: field(text(255)),
    website: field(z.string().max(255)),
    aliases: field(z.array(z.string()).max(10)),
  }),
  profile: z.object({
    sector: field(z.enum(COMPANY_SECTORS)),
    business_model: field(z.enum(["product", "service", "hybrid"])),
    hq: field(text(255)),
    headcount_band: field(text(32)),
    revenue_band: field(text(32)),
    funding_stage: field(z.enum(["public", "late-stage", "growth", "early", "bootstrapped", "subsidiary"])),
  }).optional(),
  compensation: z.object({
    wlb_rating: field(z.number().min(0).max(5)),
    wlb_review_count: field(count),
    review_summary: field(text(10_000)),
    review_quotes: field(z.array(quote).max(5)),
  }).optional(),
});

/** Validate the whole supported payload before any write. Missing/unavailable facts preserve
 * published values; an explicit empty quote list clears quotes. Roles remain in the AI-owned
 * approved snapshot until the full JD, role-config and brief publication flow is implemented. */
export function companyDraftPublication(snapshot: unknown): Partial<typeof companies.$inferInsert> {
  const parsed = publication.safeParse(snapshot);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ApiError(400, "invalid_draft", `invalid research field ${issue.path.join(".")}: ${issue.message}`);
  }
  const { profile: p, compensation: c } = parsed.data;
  const patch: Partial<typeof companies.$inferInsert> = {};
  if (p?.sector?.value != null) patch.sector = p.sector.value;
  if (p?.business_model?.value != null) patch.businessModel = p.business_model.value;
  if (p?.hq?.value != null) patch.headquarterLocation = p.hq.value;
  if (p?.headcount_band?.value != null) patch.headcountBand = p.headcount_band.value;
  if (p?.revenue_band?.value != null) patch.revenueBand = p.revenue_band.value;
  if (p?.funding_stage?.value != null) patch.fundingStage = p.funding_stage.value;
  if (c?.wlb_rating?.value != null) patch.wlbRating = c.wlb_rating.value.toFixed(1);
  if (c?.wlb_review_count?.value != null) patch.wlbReviewCount = c.wlb_review_count.value;
  if (c?.review_summary?.value != null) patch.reviewSummary = c.review_summary.value;
  if (c?.review_quotes?.value != null) patch.reviewQuotes = c.review_quotes.value;
  return patch;
}
