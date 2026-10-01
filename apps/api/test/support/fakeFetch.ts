/**
 * Programmable stand-in for global fetch. Register handlers by method + URL (string prefix or
 * RegExp); every call is recorded so tests can assert on what was sent upstream. Unmatched calls
 * fail loudly with a transport error.
 */
export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | Uint8Array | undefined;
  /** The body parsed as JSON, when it is JSON. */
  json: unknown;
}

type Responder = (call: RecordedCall) => Response | Promise<Response>;

interface Route {
  method: string;
  match: string | RegExp;
  respond: Responder;
  times: number; // remaining uses; Infinity = persistent
}

export class FakeFetch {
  readonly calls: RecordedCall[] = [];
  private routes: Route[] = [];

  /** Register a handler. Later registrations win over earlier ones. */
  on(method: string, match: string | RegExp, respond: Responder | unknown, opts: { times?: number } = {}): this {
    const r: Responder = typeof respond === "function" ? (respond as Responder) : () => json(respond);
    this.routes.unshift({ method: method.toUpperCase(), match, respond: r, times: opts.times ?? Infinity });
    return this;
  }

  once(method: string, match: string | RegExp, respond: Responder | unknown): this {
    return this.on(method, match, respond, { times: 1 });
  }

  reset(): void {
    this.routes = [];
    this.calls.length = 0;
  }

  callsTo(match: string | RegExp, method?: string): RecordedCall[] {
    return this.calls.filter((c) => matches(match, c.url) && (!method || c.method === method.toUpperCase()));
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = init?.body as string | Uint8Array | undefined;
    let parsed: unknown;
    if (typeof body === "string") {
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
    }
    const call: RecordedCall = { method, url, headers, body, json: parsed };
    this.calls.push(call);

    const route = this.routes.find((r) => r.method === method && r.times > 0 && matches(r.match, url));
    if (!route) throw new TypeError(`fetch failed: no fake route for ${method} ${url}`);
    route.times--;
    return route.respond(call);
  };
}

function matches(match: string | RegExp, url: string): boolean {
  return typeof match === "string" ? url.startsWith(match) : match.test(url);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function text(body: string, status = 200): Response {
  return new Response(body, { status });
}

export function status(code: number, body = ""): Response {
  return new Response(body, { status: code });
}
