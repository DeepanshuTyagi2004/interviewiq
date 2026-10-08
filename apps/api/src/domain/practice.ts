import type { LoopRow } from "../db/pg/schema.js";
import type { RoundNode } from "./process.js";
import type { EnrichmentBrief } from "./enrichment.js";

/** A booking-time snapshot, independent of later process edits or catalogue changes. */
export interface PracticePrepSnapshot {
  jobDescription: { id: string; title: string; description: string | null; techStack: string | null };
  companyBrief: EnrichmentBrief;
}

export function practiceSnapshot(loop: LoopRow, node: RoundNode, identity: { company: string; role: string; level: string; specialization: string | null }): PracticePrepSnapshot {
  return {
    // This is a contextual descriptor for prep, not a persisted or public JD.
    jobDescription: {
      id: loop.jdId ?? loop.id,
      title: loop.name,
      description: "User-configured simulated interview practice. This is not a verified company interview process or a job opening.",
      techStack: node.topics.join(", ") || null,
    },
    companyBrief: {
      ...identity, generated_at: loop.confirmedAt.toISOString(), generation_status: "completed",
      provenance: "custom_practice", data_confidence: "low", published_revision: null, sources: [],
      company_overview: { overview: "Simulated interview practice", culture: "", benefits: "", sourceUrls: [], verified: false },
      final_experience: {
        // Only the booked node: repeated round types must never merge instructions or timeboxes.
        rounds: [{ id: node.id, round_number: 1, name: node.name, type: node.type, kind: "interview",
          duration_minutes: node.durationMinutes, difficulty: node.difficulty, topics: node.topics,
          problems: [], format: node.instructions ?? "", provenance: "custom_practice", source_urls: [] }],
        dominant_topics: node.topics, company_specific_patterns: "User-configured simulated practice; no company endorsement.",
        data_confidence: "low", template_used: false,
      },
    },
  };
}
