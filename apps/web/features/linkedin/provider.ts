import type { LinkedInImportStatus } from "./types";

/**
 * Where a saved snapshot or draft came from, phrased to precede "snapshot". New imports are
 * uploaded PDFs; Firecrawl/Exa URL scrapes are legacy receipts kept readable until replaced.
 */
export function linkedInSourceLabel(source: Pick<LinkedInImportStatus, "method" | "provider"> | undefined): string {
  if (source?.method === "pdf") return "LinkedIn PDF";
  const labels: Record<string, string> = { firecrawl: "Firecrawl public-profile", exa: "Exa public-profile" };
  return source?.provider ? labels[source.provider] ?? "Public-profile" : "LinkedIn";
}
