import type { components } from "@/lib/api-client/generated/schema";

export type ValidationControlKey = "linkedinImportEnabled" | "requireSectionReview";

export type ValidationControlSettings = components["schemas"]["ValidationControlSettings"];

/**
 * Local until the OpenAPI schema is regenerated. The API currently omits the
 * internal updatedBy audit field; keep it optional so the UI can use it when
 * that field becomes part of the public response.
 */
export type ValidationControlsResponse = components["schemas"]["ValidationControlsResponse"];
