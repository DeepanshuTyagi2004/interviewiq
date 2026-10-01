/** Query parameters that carry one-time secrets (email verification / password reset links). */
const SECRET_PARAM = /([?&](?:token|code|state)=)[^&#\s]*/gi;

/** Replace secret query-param values in a URL-ish string, e.g. `/reset-password?token=abc`. */
export function redactUrl(value: string): string {
  return value.replace(SECRET_PARAM, "$1[redacted]");
}

/** Redact every string property that could hold a URL, shallowly (PostHog's URL props are flat). */
export function redactProperties<T extends Record<string, unknown>>(properties: T): T {
  const out: Record<string, unknown> = { ...properties };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") out[key] = redactUrl(value);
  }
  return out as T;
}
