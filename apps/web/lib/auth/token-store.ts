/**
 * In-memory access-token store.
 *
 * The access token is a short-lived (15 min) JWT issued by the backend. We keep
 * it ONLY in module memory — never localStorage/sessionStorage — so it is not
 * readable by XSS. Persistence across reloads comes from the httpOnly
 * `refresh_token` cookie (path `/api/v1/auth`), which the browser replays on a
 * silent refresh. See lib/auth/client.ts and lib/auth/AuthProvider.tsx.
 */

let accessToken: string | null = null;
/** Epoch ms at which the current access token expires. */
let expiresAt = 0;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getExpiresAt(): number {
  return expiresAt;
}

/**
 * @param token       the raw JWT
 * @param expiresInSec seconds until expiry (backend `expiresIn`)
 */
export function setAccessToken(token: string, expiresInSec: number): void {
  accessToken = token;
  expiresAt = Date.now() + expiresInSec * 1000;
}

export function clearAccessToken(): void {
  accessToken = null;
  expiresAt = 0;
}
