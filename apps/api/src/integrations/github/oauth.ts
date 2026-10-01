import type { GitHubConnectionRow } from "../../db/pg/schema.js";
import type { TokenCipher } from "../../lib/crypto.js";
import { type FetchLike, requestJson } from "../../lib/http.js";
import { asString, path } from "../../lib/json.js";
import type { GitHubConnectionRepository } from "../../repositories/pg.js";
import type { OAuthStateService } from "./oauthState.js";

export interface GitHubOAuthSettings {
  clientId: string;
  clientSecret: string;
  scope: string;
  authorizeUrl: string;
  tokenUrl: string;
  callbackUrl: string;
  apiUrl: string;
}

/** GitHub OAuth App handshake for the Profile Builder connection (not login). */
export class GitHubOAuthService {
  constructor(
    private readonly settings: GitHubOAuthSettings,
    private readonly stateService: OAuthStateService,
    private readonly tokenCipher: TokenCipher,
    private readonly connections: GitHubConnectionRepository,
    private readonly fetchImpl: FetchLike,
  ) {}

  /** The GitHub authorize URL with a signed state bound to this user. */
  buildAuthorizeUrl(userId: string): string {
    const url = new URL(this.settings.authorizeUrl);
    url.searchParams.set("client_id", this.settings.clientId);
    url.searchParams.set("redirect_uri", this.settings.callbackUrl);
    url.searchParams.set("scope", this.settings.scope);
    url.searchParams.set("state", this.stateService.issue(userId));
    return url.toString();
  }

  /**
   * Verify the state, exchange the code for an access token, fetch the login, encrypt the token,
   * and upsert the connection.
   */
  async completeConnection(code: string, state: string): Promise<GitHubConnectionRow> {
    const userId = this.stateService.verify(state);
    const accessToken = await this.exchangeCodeForToken(code);
    const login = await this.fetchLogin(accessToken);
    return this.connections.upsert({
      userId,
      githubLogin: login,
      accessTokenEnc: this.tokenCipher.encrypt(accessToken),
      scope: this.settings.scope,
    });
  }

  private async exchangeCodeForToken(code: string): Promise<string> {
    const node = await requestJson(this.fetchImpl, {
      method: "POST",
      url: this.settings.tokenUrl,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
        code,
        redirect_uri: this.settings.callbackUrl,
      }),
      timeoutMs: 30_000,
    });
    const token = asString(path(node, "access_token"), "");
    if (token === "") {
      throw new Error(`GitHub token exchange failed: ${asString(path(node, "error"), "unknown_error")}`);
    }
    return token;
  }

  private async fetchLogin(accessToken: string): Promise<string> {
    const node = await requestJson(this.fetchImpl, {
      method: "GET",
      url: `${this.settings.apiUrl}/user`,
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, "User-Agent": "interviewiq-backend" },
      timeoutMs: 30_000,
    });
    return asString(path(node, "login"), "");
  }
}
