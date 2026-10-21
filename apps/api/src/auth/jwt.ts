import { jwtVerify, SignJWT } from "jose";
import type { Role } from "../domain/enums.js";

export interface AuthPrincipal {
  userId: string;
  email: string | null;
  name: string | null;
  role: Role | null;
}

/**
 * HS256 access tokens, keyed with the UTF-8 bytes of JWT_SECRET — the same key derivation and
 * claims (iss, iat, exp, sub=userId, email, name, role) as the Spring JwtService, so tokens are
 * interchangeable across the migration.
 */
export class JwtService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly accessTokenMinutes: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  get accessTokenSeconds(): number {
    return this.accessTokenMinutes * 60;
  }

  createAccessToken(user: { id: string; email: string; name: string; role: Role }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email: user.email, name: user.name, role: user.role })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("interviewiq-backend")
      .setIssuedAt(now)
      .setExpirationTime(now + this.accessTokenSeconds)
      .setSubject(user.id)
      .sign(this.key);
  }

  /** Verify signature + expiry (60s clock skew, like Spring's default). Throws on any problem. */
  async verify(token: string): Promise<AuthPrincipal> {
    const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], clockTolerance: 60 });
    if (typeof payload.sub !== "string" || payload.sub === "") throw new Error("token has no subject");
    const role = payload.role === "ADMIN" || payload.role === "CANDIDATE" || payload.role === "USER" ? payload.role : null;
    return {
      userId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null,
      role,
    };
  }
}
