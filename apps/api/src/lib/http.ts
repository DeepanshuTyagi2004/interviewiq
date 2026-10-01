/**
 * Outbound HTTP (AI service, GitHub, LeetCode, Google). A thin layer over global `fetch` that
 * classifies failures the way Spring's RestClient did, so callers can keep the same handling:
 *
 *   UpstreamError            ≈ RestClientException (any outbound failure)
 *   ├─ UpstreamHttpError     ≈ RestClientResponseException (non-2xx; carries the status)
 *   ├─ UpstreamTransportError  (DNS / connect / timeout / reset)
 *   └─ UpstreamMalformedError  (2xx whose body is not the JSON we expected)
 *
 * Node's fetch speaks HTTP/1.1 to cleartext targets, so the h2c-upgrade problem the Java client
 * had to pin around (uvicorn dropping upgraded request bodies) doesn't arise here.
 */

export type FetchLike = typeof fetch;

export class UpstreamError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UpstreamError";
  }
}

export class UpstreamHttpError extends UpstreamError {
  constructor(
    readonly status: number,
    readonly responseBody: string,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamHttpError";
  }
}

export class UpstreamTransportError extends UpstreamError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UpstreamTransportError";
  }
}

export class UpstreamMalformedError extends UpstreamError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UpstreamMalformedError";
  }
}

export function isUpstreamStatus(err: unknown, status: number): err is UpstreamHttpError {
  return err instanceof UpstreamHttpError && err.status === status;
}

export interface OutboundRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** Perform a request and return the raw body text. Throws UpstreamHttpError on non-2xx. */
export async function requestText(fetchImpl: FetchLike, req: OutboundRequest): Promise<string> {
  const label = `${req.method} ${redact(req.url)}`;
  let res: Response;
  try {
    res = await fetchImpl(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body as RequestInit["body"],
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new UpstreamTransportError(`${label} failed: ${describe(err)}`, { cause: err });
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new UpstreamTransportError(`${label} failed reading the response: ${describe(err)}`, { cause: err });
  }
  if (!res.ok) {
    throw new UpstreamHttpError(res.status, text, `${label} -> ${res.status}: ${truncate(text, 300)}`);
  }
  return text;
}

/** Parse a JSON body; a non-JSON body becomes an UpstreamMalformedError. */
export function parseJsonBody(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UpstreamMalformedError(`${what} returned a body that is not valid JSON`, { cause: err });
  }
}

export async function requestJson(fetchImpl: FetchLike, req: OutboundRequest): Promise<unknown> {
  return parseJsonBody(await requestText(fetchImpl, req), `${req.method} ${redact(req.url)}`);
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
  }
  return String(err);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Never let query-string secrets reach the logs. */
function redact(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : `${url.slice(0, q)}?…`;
}
