/** Restrict inputs and evidence links to canonical HTTPS LinkedIn member URLs. Server revalidates. */
export function canonicalLinkedInUrl(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  const trimmed = raw.trim();
  // Validate the original path before URL normalization can erase dot segments or explicit :443.
  if ([...trimmed].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === "\\")) return null;
  const authorityNormalized = trimmed.replace(/^https:\/\/[^/]+/, (authority) => authority.toLowerCase());
  const match = authorityNormalized.match(/^https:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,199})\/?(?:[?#].*)?$/);
  return match ? `https://www.linkedin.com/in/${match[1]}/` : null;
}
