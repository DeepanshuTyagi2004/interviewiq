/**
 * Company slug: the join key between Postgres rows, AI-service briefs and research fixtures.
 * MUST stay byte-identical to apps/ai-service/app/research/normalize/identity.py::slugify:
 * NFKD-fold, drop non-ASCII, lowercase, "&" → " and ", non-alphanumerics → "-", trim "-".
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
