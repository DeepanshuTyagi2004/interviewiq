import { cleanText, list, number, object, sortedUnique } from "./sanitization.js";
import type { StoredLLMAssessment } from "./types.js";

export interface ValidatedLLMAssessment extends StoredLLMAssessment {
  evidenceType: "INFERRED";
  confidence: number;
  sourceMetadata: { source: string; model: string | null; assessedAt: string | null };
}

/**
 * Validate stored assessment output only. This is intentionally not an LLM client: assessment
 * producers persist bounded claims, and the deterministic engine decides the final score.
 */
export function validateLLMAssessment(raw: unknown): ValidatedLLMAssessment | null {
  const value = object(raw), dimension = cleanText(value.dimension);
  const score = number(value.score), refs = sortedUnique(list(value.evidenceRefs ?? value.evidencePaths).map((x) => cleanText(x)).filter((x): x is string => !!x));
  if (!dimension || score === null || score < 0 || score > 100 || refs.length === 0) return null;
  const rawConfidence = number(value.confidence) ?? 45;
  if (rawConfidence < 0 || rawConfidence > 100) return null;
  const confidence = Math.min(45, rawConfidence);
  return {
    id: typeof value.id === "string" ? value.id.slice(0, 120) : undefined,
    dimension: dimension.toLowerCase().slice(0, 100), score, confidence, evidenceRefs: refs.slice(0, 20),
    assessedAt: typeof value.assessedAt === "string" ? value.assessedAt : null,
    model: cleanText(value.model), source: cleanText(value.source) ?? "stored_llm_assessment",
    evidenceType: "INFERRED", sourceMetadata: { source: cleanText(value.source) ?? "stored_llm_assessment", model: cleanText(value.model), assessedAt: typeof value.assessedAt === "string" ? value.assessedAt : null },
  };
}

export function validateLLMAssessments(raw: unknown, max = 50): ValidatedLLMAssessment[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, max).map(validateLLMAssessment).filter((value): value is ValidatedLLMAssessment => value !== null);
}

export const sanitizeLLMAssessments = validateLLMAssessments;
