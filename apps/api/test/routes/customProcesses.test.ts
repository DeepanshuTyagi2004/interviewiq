import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobDescriptions, manualJdBriefs } from "../../src/db/pg/schema.js";
import { enrichmentBrief, type EnrichmentRole } from "../../src/domain/enrichment.js";
import { MOCK_ROUND_MINUTES } from "../../src/domain/liveRound.js";
import type { ProcessGraph } from "../../src/domain/process.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";

const round = (id: string, topics: string[], instructions: string) => ({
  id, kind: "round" as const, type: "dsa" as const, name: id, durationMinutes: MOCK_ROUND_MINUTES,
  difficulty: "hard" as const, topics, instructions, position: { x: 0, y: 0 },
});
const graph: ProcessGraph = {
  nodes: [round("graphs", ["Graph traversal", "Dijkstra"], "Ask for complexity and an edge-case walkthrough."),
    round("sql", ["SQL joins"], "Focus only on SQL joins, not graph traversal."),
    { id: "take-home", kind: "info", name: "Take-home", note: "Optional", topics: ["Testing"], difficulty: "easy", instructions: "Submit a README.", position: { x: 0, y: -170 } }],
  edges: [{ source: "graphs", target: "sql" }],
};
const slot = (days = 2) => new Date(Date.now() + days * 86400000).toISOString();

describe("persisted custom practice processes", () => {
  let env: TestEnv;
  let auth: string;
  let userId: string;
  beforeAll(async () => { env = await createTestEnv(); });
  afterAll(() => env.close());
  beforeEach(async () => {
    env.fetch.reset();
    const user = await createUser(env);
    userId = user.id;
    auth = await bearer(env, user);
  });
  const api = (method: "get" | "post" | "put" | "delete", path: string) => env.http[method](`/api/v1/${path}`).set("Authorization", auth);
  const create = (body: object = { name: "Backend practice", level: "staff", graph }) => api("post", "processes").send(body);
  const book = (loopId: string, nodeId: string, days = 2, authorization = auth) => env.http.post("/api/v1/interviews/sessions")
    .set("Authorization", authorization).send({ loopId, nodeId, scheduledAt: slot(days), timezone: "Asia/Kolkata" });

  it("creates with just name/level, saves/reopens/copies graph, confirms and preps with no JD", async () => {
    const minimal = await create({ name: "Quick practice", level: "fresher" });
    expect(minimal.status).toBe(201);
    expect(minimal.body.jd).toBeNull();
    expect(minimal.body.graph.nodes[0].type).toBe("dsa");
    expect(minimal.body.graph.nodes[0].durationMinutes).toBe(MOCK_ROUND_MINUTES); // the default round is a mock round
    const made = await create();
    expect(made.status).toBe(201);
    expect(made.body.level).toBe("staff");
    const id = made.body.id as string;
    const edited = await api("put", `processes/${id}`).send({ name: "My graph practice", level: "sde2", graph });
    expect(edited.status).toBe(200);
    expect((await api("get", `processes/${id}`)).body).toMatchObject({ name: "My graph practice", level: "sde2", jd: null, graph });
    expect((await api("get", "processes")).body.processes.some((p: { id: string }) => p.id === id)).toBe(true);
    const copied = await api("post", `processes/${id}/duplicate`);
    expect(copied.status).toBe(201);
    expect(copied.body).toMatchObject({ level: "sde2", jd: null, graph });

    const confirmed = await api("post", "loops").send({ processId: id });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ name: "My graph practice", level: "sde2", jdId: null, jd: null, kind: "standalone", countsTowardReadiness: false });
    const loopId = confirmed.body.id as string;
    expect((await api("get", `loops/${loopId}`)).body.graph).toEqual(graph);
    expect((await book(loopId, "sql")).body.code).toBe("round_locked");
    expect((await book(loopId, "take-home")).body.code).toBe("session_node_not_found");
    const booked = await book(loopId, "graphs");
    expect(booked.status).toBe(201);
    expect(booked.body).toMatchObject({ jobDescriptionId: null, company: "custom-practice", role: "My graph practice", level: "sde2", roundType: "dsa" });
    expect((await book(loopId, "graphs", 3)).body.code).toBe("round_already_booked");

    // Changing or deleting the original process cannot rewrite the confirmed or booked snapshots.
    await api("put", `processes/${id}`).send({ name: "Changed", level: "sde1", graph: { ...graph, nodes: [round("changed", ["Arrays"], "Changed")] , edges: [] } });
    expect((await api("delete", `processes/${id}`)).status).toBe(204);
    const s = (await env.c.repos.sessions.findById(booked.body.id))!;
    await env.c.background.drain();
    const body = await env.c.blueprintPrep.assemble(s, "booking");
    expect(body.job_description.id).toBe(loopId);
    expect(body.job_description.title).toBe("My graph practice");
    expect(body.session).toMatchObject({ company: s.company, role: s.role, level: s.level, specialization: s.specialization });
    expect(body.round).toMatchObject({ type: "dsa", topics: ["Graph traversal", "Dijkstra"], difficulty: "hard", duration_mins: MOCK_ROUND_MINUTES,
      format: graph.nodes[0]!.instructions, source: "practice" });
    expect(body.company_brief?.company_specific_patterns).toContain("no company endorsement");
    expect(env.fetch.callsTo(/\/briefs\//)).toHaveLength(0);
    env.fetch.on("POST", "http://ai.test/blueprints/runs", { run_id: "bpr_custom", status: "running", existing: false });
    env.fetch.on("GET", "http://ai.test/blueprints/runs/bpr_custom", { status: "completed", input_hash: body.input_hash, blueprint_version: 1,
      briefing: { interviewer_name: "Asha", interviewer_style: "calm", format: "45-minute coding interview with a shared editor", duration_mins: 45 } });
    await env.c.repos.sessions.update(s.id, { prepRunId: null });
    await env.c.blueprintPrep.start((await env.c.repos.sessions.findById(s.id))!, "reconcile");
    await env.c.blueprintPrep.collect((await env.c.repos.sessions.findById(s.id))!);
    expect((await env.c.repos.sessions.findById(s.id))!.status).toBe("PREP_READY");
    expect((await api("get", `loops/${loopId}`)).body).toMatchObject({ name: "My graph practice", processId: null, countsTowardReadiness: false });
    await env.c.repos.sessions.update(s.id, { status: "COMPLETED" });
    const second = await book(loopId, "sql", 4);
    expect(second.status).toBe(201);
    const secondBody = await env.c.blueprintPrep.assemble((await env.c.repos.sessions.findById(second.body.id))!, "booking");
    expect(secondBody.round!.topics).toEqual(["SQL joins"]);
    expect(secondBody.round!.format).toBe("Focus only on SQL joins, not graph traversal.");
  });

  it("scopes process, loop and booking access to the owner before disclosing graph/gating state", async () => {
    const p = (await create()).body;
    const loop = (await api("post", "loops").send({ processId: p.id })).body;
    const other = await bearer(env, await createUser(env));
    for (const path of [`processes/${p.id}`, `loops/${loop.id}`]) {
      expect((await env.http.get(`/api/v1/${path}`).set("Authorization", other)).status).toBe(404);
    }
    expect((await env.http.put(`/api/v1/processes/${p.id}`).set("Authorization", other).send({ level: "Junior" })).status).toBe(404);
    expect((await env.http.post("/api/v1/loops").set("Authorization", other).send({ processId: p.id })).status).toBe(404);
    expect((await book(loop.id, "sql", 2, other)).body.code).toBe("session_not_found");
    expect((await env.http.post("/api/v1/processes").send({ name: "Unauthorized", level: "Junior" })).status).toBe(401);
  });

  it("validates custom level and instructions boundaries while allowing legacy info nodes", async () => {
    expect((await create({ name: "P" })).body.code).toBe("invalid_process");
    expect((await create({ name: "P", level: " ", graph })).body.code).toBe("invalid_process");
    expect((await create({ name: "P", level: "x".repeat(65), graph })).body.code).toBe("invalid_process");
    expect((await create({ name: "P", level: "x".repeat(64), graph })).status).toBe(400);
    const invalid = { nodes: [round("r", [], "x".repeat(4001))], edges: [] };
    expect((await create({ name: "P", level: "sde1", graph: invalid })).body.code).toBe("invalid_process");
    const legacy = { nodes: [round("r", [], ""), { id: "oa", kind: "info", name: "OA", note: "", position: { x: 0, y: -170 } }], edges: [] };
    expect((await create({ name: "P", level: "sde1", graph: legacy })).status).toBe(201);
  });

  async function withBrief(source: string) {
    const company = await env.c.repos.companies.create({ name: `Company ${randomUUID()}`, slug: `company-${randomUUID()}`, publishedAt: new Date() });
    const jd = await env.c.repos.jds.insert({ company: company.slug, role: "software-engineer", level: "sde1", title: source === "template" ? "[Practice template] SDE I" : "SDE I", source, active: true, description: "Simulated if marked template" });
    const role: EnrichmentRole = { id: randomUUID(), title: jd.title, role: jd.role, level: "sde1", specialization: null,
      description: jd.description ?? "", techStack: [], yoeMin: null, yoeMax: null, ctcMinLpa: null, ctcMaxLpa: null,
      sourceUrls: [], verified: source !== "template", rounds: [{ id: randomUUID(), name: "Coding", type: "dsa", durationMinutes: 60,
        difficulty: "medium", topics: ["Arrays"], questions: [], guidance: "Discuss trade-offs", sourceUrls: [], verified: source !== "template" }] };
    const brief = enrichmentBrief(company.slug, role, { overview: "Overview", culture: "", benefits: "", sourceUrls: [], verified: source !== "template" }, 1, new Date());
    if (source === "template") {
      brief.provenance = "practice_template";
      brief.data_confidence = "low";
      brief.final_experience.data_confidence = "low";
      brief.final_experience.template_used = true;
    }
    await env.db.insert(manualJdBriefs).values({ jdId: jd.id, companyId: company.id, roleId: role.id, brief });
    return jd;
  }

  it("copies a JD's suggested graph but keeps the saved process and confirmation custom", async () => {
    const jd = await withBrief("manual");
    const copied = await create({ name: "Copied coding", level: "staff", jdId: jd.id });
    expect(copied.status).toBe(201);
    expect(copied.body.jd.practiceTemplate).toBe(false);
    expect(copied.body.graph.nodes[0].instructions).toBe("Discuss trade-offs");
    const custom = await api("post", "loops").send({ processId: copied.body.id, jdId: null });
    expect(custom.body).toMatchObject({ jdId: null, kind: "standalone", countsTowardReadiness: false, level: "staff" });
    const linked = await api("post", "loops").send({ processId: copied.body.id, jdId: jd.id });
    expect(linked.body).toMatchObject({ jdId: jd.id, kind: "standalone", countsTowardReadiness: false });
    // A custom copied graph runs without provisioning a normal company-role configuration.
    const booked = await book(linked.body.id, copied.body.graph.nodes[0].id);
    expect(booked.status).toBe(201);
    expect(booked.body.level).toBe("staff");
  });

  it("makes every mock round 45 minutes: saved, suggested and booked, whatever the client or the research says", async () => {
    // An old client still sends 55 minutes; it is saved as 45.
    expect(MOCK_ROUND_MINUTES).toBe(45);
    const stale = { ...graph, nodes: graph.nodes.map((n) => (n.kind === "round" ? { ...n, durationMinutes: 55 } : n)) };
    const made = await create({ name: "Old client", level: "sde1", graph: stale });
    expect(made.status).toBe(201);
    const lengths = (g: ProcessGraph) => g.nodes.filter((n) => n.kind === "round").map((n) => (n as { durationMinutes: number }).durationMinutes);
    expect(lengths(made.body.graph)).toEqual([MOCK_ROUND_MINUTES, MOCK_ROUND_MINUTES]);
    const edited = await api("put", `processes/${made.body.id}`).send({ graph: stale });
    expect(lengths(edited.body.graph)).toEqual([MOCK_ROUND_MINUTES, MOCK_ROUND_MINUTES]);
    // A JD's suggested process is built from the researched round (60 minutes) but shown and saved as 45.
    const jd = await withBrief("manual");
    const official = await api("get", `processes/official/${jd.id}`);
    expect(lengths(official.body.graph)).toEqual([MOCK_ROUND_MINUTES]);
    const copied = await create({ name: "Copied", level: "sde1", jdId: jd.id });
    expect(lengths(copied.body.graph)).toEqual([MOCK_ROUND_MINUTES]);
    const loop = await api("post", "loops").send({ jdId: jd.id });
    expect(lengths(loop.body.graph)).toEqual([MOCK_ROUND_MINUTES]);
  });

  it("marks simulated templates in list/detail/brief and always excludes them from readiness", async () => {
    const jd = await withBrief("template");
    const listed = await api("get", `jds?company=${jd.company}`);
    expect(listed.status).toBe(200);
    expect(listed.body[0]).toMatchObject({ practiceTemplate: true, dataConfidence: "low", dataAvailability: "limited" });
    expect((await api("get", `jds/${jd.id}`)).body).toMatchObject({ practiceTemplate: true, dataConfidence: "low" });
    const copied = await create({ name: "My template", jdId: jd.id });
    expect(copied.body.jd.practiceTemplate).toBe(true);
    const suggested = await api("post", "loops").send({ jdId: jd.id });
    expect(suggested.status).toBe(201);
    expect(suggested.body).toMatchObject({ kind: "standalone", countsTowardReadiness: false });
    const session = await book(suggested.body.id, suggested.body.graph.nodes[0].id);
    expect(session.status).toBe(201);
    await env.c.repos.sessions.update(session.body.id, { status: "COMPLETED" });
    expect((await api("get", `loops/${suggested.body.id}`)).body).toMatchObject({ status: "completed", countsTowardReadiness: false });
    const custom = await api("post", "loops").send({ jdId: jd.id, processId: copied.body.id });
    expect(custom.body).toMatchObject({ kind: "standalone", countsTowardReadiness: false });
    await env.c.background.drain();
    // Templates never fetch AI research; the only AI-service traffic is the booking's blueprint run.
    expect(env.fetch.calls.filter((c) => !c.url.includes("/blueprints/"))).toHaveLength(0);
  });

  it("hides inactive templates from catalogue detail and refuses confirming their suggested process", async () => {
    const jd = await withBrief("template");
    await env.db.update(jobDescriptions).set({ active: false }).where(eq(jobDescriptions.id, jd.id));
    expect((await api("get", `jds/${jd.id}`)).status).toBe(404);
    expect((await api("get", `jds?company=${jd.company}`)).body).toEqual([]);
    expect((await api("post", "loops").send({ jdId: jd.id })).status).toBe(404);
    expect(env.fetch.calls.filter((c) => !c.url.includes("/blueprints/"))).toHaveLength(0);
  });

  it("preserves official loop readiness, uniqueness, booking config checks and identity", async () => {
    const jd = await withBrief("manual");
    const official = await api("post", "loops").send({ jdId: jd.id });
    expect(official.body).toMatchObject({ kind: "official", countsTowardReadiness: true, name: jd.title, level: jd.level });
    expect((await api("post", "loops").send({ jdId: jd.id })).body.code).toBe("loop_exists");
    const node = official.body.graph.nodes[0];
    expect((await book(official.body.id, node.id)).body.code).toBe("session_role_not_configured");
    await env.c.repos.roleConfigs.insert({ company: jd.company, role: jd.role, level: jd.level, enabled: false });
    expect((await book(official.body.id, node.id)).body.code).toBe("session_role_disabled");
    const config = (await env.c.repos.roleConfigs.findByCompanyAndRoleAndLevel(jd.company, jd.role, jd.level))!;
    await env.c.repos.roleConfigs.update(config.id, { enabled: true });
    const booked = await book(official.body.id, node.id);
    expect(booked.status).toBe(201);
    const s = (await env.c.repos.sessions.findById(booked.body.id))!;
    expect(s.practicePrep).toBeNull();
    expect(s.candidateId).toBe(userId);
    expect(s.company).toBe(jd.company);
    expect(s.jobDescriptionId).toBe(jd.id);
    expect((await env.c.blueprintPrep.assemble(s, "booking")).round?.source).toBe("brief");
  });
});
