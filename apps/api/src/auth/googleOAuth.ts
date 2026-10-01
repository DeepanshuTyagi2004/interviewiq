import { createHash } from "node:crypto";
import { type FetchLike, requestJson } from "../lib/http.js";
import { asString, path } from "../lib/json.js";
import { randomToken, secureEquals } from "../lib/crypto.js";
import type { GoogleIdentity } from "../services/userService.js";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleOAuthSettings {
  clientId: string;
  clientSecret: string;
  /** `${API_PUBLIC_URL}/login/oauth2/code/google` — same path Spring used, so the Google console config is unchanged. */
  redirectUri: string;
}

/** What we keep in the short-lived, httpOnly handshake cookie between the two legs. */
export interface PendingAuthorization {
  state: string;
  codeVerifier: string;
}

/**
 * Backend-owned Google login (authorization-code flow with PKCE), replacing Spring Security's
 * `oauth2Login()`. Two legs, at the same URLs Spring served:
 *   GET /oauth2/authorization/google  → 302 to Google (state + PKCE challenge)
 *   GET /login/oauth2/code/google     → exchange the code, read the OIDC userinfo
 */
export class GoogleOAuthService {
  constructor(
    private readonly settings: GoogleOAuthSettings,
    private readonly fetchImpl: FetchLike,
  ) {}

  begin(): { url: string; pending: PendingAuthorization } {
    const pending = { state: randomToken(32), codeVerifier: randomToken(48) };
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.settings.clientId);
    url.searchParams.set("redirect_uri", this.settings.redirectUri);
    url.searchParams.set("scope", "openid profile email");
    url.searchParams.set("state", pending.state);
    url.searchParams.set("code_challenge", createHash("sha256").update(pending.codeVerifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString(), pending };
  }

  /** Validate the callback and resolve the Google identity. Throws on any mismatch/failure. */
  async complete(query: { code?: string | null; state?: string | null; error?: string | null }, pending: PendingAuthorization | null): Promise<GoogleIdentity> {
    if (query.error) throw new Error(`Google returned error: ${query.error}`);
    if (!query.code || !query.state) throw new Error("missing code or state");
    if (!pending || !secureEquals(pending.state, query.state)) throw new Error("OAuth state mismatch");

    const token = await requestJson(this.fetchImpl, {
      method: "POST",
      url: TOKEN_URL,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: this.settings.redirectUri,
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        code_verifier: pending.codeVerifier,
      }).toString(),
      timeoutMs: 30_000,
    });
    const accessToken = asString(path(token, "access_token"), "");
    if (accessToken === "") throw new Error("Google token exchange returned no access_token");

    const info = await requestJson(this.fetchImpl, {
      method: "GET",
      url: USERINFO_URL,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      timeoutMs: 30_000,
    });
    const sub = asString(path(info, "sub"), "");
    const email = asString(path(info, "email"), "");
    if (sub === "" || email === "") throw new Error("Google userinfo is missing sub/email");
    const name = asString(path(info, "name"), "") || email.split("@")[0]!;
    // OIDC userinfo sends a JSON boolean; tolerate the string form some Google endpoints use.
    const verifiedClaim = path(info, "email_verified");
    const emailVerified = verifiedClaim === true || verifiedClaim === "true";
    return { sub, email, name, emailVerified };
  }
}

export function encodePending(p: PendingAuthorization): string {
  return `${p.state}.${p.codeVerifier}`;
}

export function decodePending(raw: unknown): PendingAuthorization | null {
  if (typeof raw !== "string") return null;
  const [state, codeVerifier] = raw.split(".");
  return state && codeVerifier ? { state, codeVerifier } : null;
}
