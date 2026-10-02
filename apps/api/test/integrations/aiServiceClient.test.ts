import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiServiceClient } from "../../src/integrations/aiService/client.js";
import type { GenerateInterviewPlanRequest } from "../../src/integrations/aiService/types.js";
import { UpstreamHttpError, UpstreamMalformedError } from "../../src/lib/http.js";
import { silentLogger } from "../../src/lib/logger.js";
import { FakeFetch, json, status, text } from "../support/fakeFetch.js";

/**
 * Ported from integrations/aiservice/AiServiceClientBodyIT.java — regression guard for the "empty
 * file" resume-parse bug: the PDF bytes must reach the ai-service intact, as application/pdf, with
 * the internal key, and without an h2c upgrade (which made uvicorn drop the body). Plus request-shape
 * checks for the other body-carrying calls.
 */

const BASE = "http://ai.test";
const KEY = "test-key";
const pdfBytes = new TextEncoder().encode("%PDF-1.4 hello resume");

describe("AiServiceClient request shape (FakeFetch)", () => {
  let fake: FakeFetch;
  let client: AiServiceClient;

  beforeEach(() => {
    fake = new FakeFetch();
    client = new AiServiceClient(BASE, KEY, fake.fetch, silentLogger());
  });

  it("parseResume POSTs the raw PDF bytes as application/pdf with the internal key", async () => {
    fake.on("POST", `${BASE}/resumes/parse`, () => text('{"full_name":"ok"}'));

    const body = await client.parseResume(pdfBytes);

    expect(body).toBe('{"full_name":"ok"}');
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${BASE}/resumes/parse`);
    expect(call.headers["x-internal-api-key"]).toBe(KEY);
    expect(call.headers["content-type"]).toContain("application/pdf");
    expect(call.headers["accept"]).toBe("application/json"); // RestClientConfig default header
    expect(call.body).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(call.body as Uint8Array).equals(Buffer.from(pdfBytes))).toBe(true);
  });

  it("parseResume does not swallow failures: a 422 surfaces with its status", async () => {
    fake.on("POST", `${BASE}/resumes/parse`, () => json({ detail: "scanned pdf" }, 422));
    const err = await client.parseResume(pdfBytes).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamHttpError);
    expect((err as UpstreamHttpError).status).toBe(422);
  });

  it("parseResume treats a blank 2xx body as a broken upstream", async () => {
    fake.on("POST", `${BASE}/resumes/parse`, () => text("   "));
    await expect(client.parseResume(pdfBytes)).rejects.toBeInstanceOf(UpstreamMalformedError);
  });

  it("startResumeParseRun sends the same PDF body contract with an encoded filename", async () => {
    fake.on("POST", `${BASE}/admin/resume/parse/run`, { run_id: "r1", status: "running" });
    // Non-ASCII filename on purpose: checks the query-string encoding.
    await expect(client.startResumeParseRun(pdfBytes, "my résumé.pdf")).resolves.toEqual({ run_id: "r1", status: "running" });
    const call = fake.calls[0]!;
    expect(call.url).toBe(`${BASE}/admin/resume/parse/run?filename=my%20r%C3%A9sum%C3%A9.pdf`);
    expect(call.headers["content-type"]).toContain("application/pdf");
    expect(call.headers["x-internal-api-key"]).toBe(KEY);
    expect(Buffer.from(call.body as Uint8Array).equals(Buffer.from(pdfBytes))).toBe(true);
  });

  it("startInterviewPlan POSTs the request as JSON and returns run_id", async () => {
    fake.on("POST", `${BASE}/interview-plans/start`, { run_id: "run-42", status: "running" });
    const request = { session_id: "s1", round_type: "dsa" } as unknown as GenerateInterviewPlanRequest;

    expect(await client.startInterviewPlan(request)).toBe("run-42");
    const call = fake.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers["x-internal-api-key"]).toBe(KEY);
    expect(call.json).toEqual(request);
  });

  it("startInterviewPlan without a run_id (or with an empty body) is malformed", async () => {
    fake.on("POST", `${BASE}/interview-plans/start`, { status: "running" });
    await expect(client.startInterviewPlan({} as GenerateInterviewPlanRequest)).rejects.toThrow("returned no run_id");
    fake.on("POST", `${BASE}/interview-plans/start`, () => text(""));
    await expect(client.startInterviewPlan({} as GenerateInterviewPlanRequest)).rejects.toThrow("returned an empty body");
  });

  it("submitExperience sends the snake_case JSON body", async () => {
    fake.on("POST", `${BASE}/admin/experiences`, { ok: true });
    await client.submitExperience("acme", "sde", "sde1", "raw text");
    expect(fake.calls[0]!.json).toEqual({ company: "acme", role: "sde", level: "sde1", raw_content: "raw text" });
    expect(fake.calls[0]!.headers["content-type"]).toBe("application/json");
  });

  it("bodyless admin POSTs still carry the internal key and no body", async () => {
    fake.on("POST", `${BASE}/admin/scrape/run`, { started: true });
    await client.triggerScrape();
    const call = fake.calls[0]!;
    expect(call.headers["x-internal-api-key"]).toBe(KEY);
    expect(call.body).toBeUndefined();
  });

  it("fetchBrief: path segments are URI-encoded; 404 and failures resolve to null (never throws)", async () => {
    fake.on("GET", `${BASE}/briefs/`, { consolidated_process: {} });
    expect(await client.fetchBrief("Acme Co", "SDE", "sde1", "backend")).toEqual({ consolidated_process: {} });
    expect(fake.calls[0]!.url).toBe(`${BASE}/briefs/Acme%20Co/SDE/sde1/backend`);
    expect(fake.calls[0]!.headers["x-internal-api-key"]).toBe(KEY);

    fake.on("GET", `${BASE}/briefs/`, () => status(404));
    expect(await client.fetchBrief("a", "b", "c", "d")).toBeNull();
    fake.on("GET", `${BASE}/briefs/`, () => status(500));
    expect(await client.fetchBrief("a", "b", "c", "d")).toBeNull();
  });

  it("fetchBrief with a null specialization requests the same URL Spring's URI template did (null -> empty segment)", async () => {
    // Spring's DefaultUriBuilderFactory (RestClient's default) expands a null URI variable to "":
    //   expand(".../briefs/{company}/{role}/{level}/{specialization}", "Acme Co", "SDE", "sde1", null)
    //   -> http://ai.test/briefs/Acme%20Co/SDE/sde1/
    fake.on("GET", `${BASE}/briefs/`, () => status(404));
    await client.fetchBrief("Acme Co", "SDE", "sde1", null);
    expect(fake.calls[0]!.url).toBe(`${BASE}/briefs/Acme%20Co/SDE/sde1/`);
  });
});

describe("AiServiceClient against a real capture server (AiServiceClientBodyIT)", () => {
  let server: Server;
  let baseUrl: string;
  let received: { length: number; headers: IncomingHttpHeaders; httpVersion: string } | null = null;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        received = { length: Buffer.concat(chunks).length, headers: req.headers, httpVersion: req.httpVersion };
        const resp = Buffer.from('{"full_name":"ok"}', "utf8");
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": resp.length });
        res.end(resp);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("postsPdfBody_overHttp11_withoutH2cUpgrade", async () => {
    // The real transport the app wires (global fetch), not a stub.
    const client = new AiServiceClient(baseUrl, KEY, globalThis.fetch, silentLogger());

    const body = await client.parseResume(pdfBytes);

    expect(body.trim()).not.toBe("");
    expect(received).not.toBeNull();
    expect(received!.headers["content-type"]).toContain("application/pdf");
    expect(received!.headers["x-internal-api-key"]).toBe(KEY);
    // bytes the ai-service actually received
    expect(received!.length).toBe(pdfBytes.length);
    expect(received!.httpVersion).toBe("1.1");
    // The crux: no h2c upgrade, so uvicorn delivers the body.
    expect(received!.headers["upgrade"]).toBeUndefined();
    expect(received!.headers["http2-settings"]).toBeUndefined();
    if (received!.headers["connection"] !== undefined) {
      expect(received!.headers["connection"].toLowerCase()).not.toContain("upgrade");
    }
  });
});
