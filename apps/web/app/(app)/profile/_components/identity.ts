// Shared with onboarding's live preview, so both headline the same education entry.
export { educationLine, primaryEducation } from "@/features/onboarding/education";

/** "2023–2027", "2027", or null. */
export function yearRange(start: string | null, end: string | null): string | null {
  const parts = [start, end].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join("–") : null;
}

/**
 * A user-typed project link as a safe href: http(s) URLs as-is, bare domains ("github.com/a/b")
 * get https://, anything else (javascript:, mailto:, junk) → null so it renders as plain text.
 */
export function externalHref(link: string | null): string | null {
  const raw = link?.trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw) ? `https://${raw}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? (url.username || url.password ? null : url.href) : null;
  } catch {
    return null;
  }
}

/** A link as shown on screen: no protocol, no trailing slash ("github.com/asha/ledger"). */
export function displayLink(href: string): string {
  return href.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
