import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../../src/db/pg/client.js";

it("custom-practice migration preserves existing IDs, graph/session snapshots and backfills metadata", async () => {
  const db = new PGlite();
  try {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter((e) => e.idx < 6)) await db.exec(readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), "utf8"));
    const user = randomUUID();
    const jd = randomUUID();
    const process = randomUUID();
    const loop = randomUUID();
    const session = randomUUID();
    const graph = { nodes: [{ id: "existing-round" }], edges: [] };
    await db.query("insert into job_descriptions (id,company,role,level,title,source,active,created_at) values ($1,'real-company','engineer','sde2','Real opening','manual',true,now())", [jd]);
    await db.query("insert into interview_processes (id,user_id,jd_id,name,graph,created_at,updated_at) values ($1,$2,$3,'My existing process',$4,now(),now())", [process, user, jd, JSON.stringify(graph)]);
    await db.query("insert into loops (id,user_id,jd_id,process_id,kind,status,graph,confirmed_at,created_at,updated_at) values ($1,$2,$3,$4,'standalone','active',$5,now(),now(),now())", [loop, user, jd, process, JSON.stringify(graph)]);
    await db.query("insert into interview_sessions (id,candidate_id,job_description_id,company,role,level,round_type,scheduled_at,timezone,status,plan_version,input_hash,created_at,updated_at,loop_id,node_id) values ($1,$2,$3,'real-company','engineer','sde2','dsa',now(),'UTC','PREP_READY','existing-v1','existing-hash',now(),now(),$4,'existing-round')", [session, user, jd, loop]);
    await db.exec(readFileSync(join(MIGRATIONS_FOLDER, "0006_custom_practice.sql"), "utf8"));
    expect((await db.query("select id,jd_id,name,level,graph from interview_processes")).rows).toEqual([{ id: process, jd_id: jd, name: "My existing process", level: "sde2", graph }]);
    expect((await db.query("select id,jd_id,process_id,name,level,kind,status,graph from loops")).rows).toEqual([{ id: loop, jd_id: jd, process_id: process, name: "My existing process", level: "sde2", kind: "standalone", status: "active", graph }]);
    expect((await db.query("select id,job_description_id,status,plan_version,input_hash,loop_id,node_id,practice_prep from interview_sessions")).rows).toEqual([{ id: session, job_description_id: jd, status: "PREP_READY", plan_version: "existing-v1", input_hash: "existing-hash", loop_id: loop, node_id: "existing-round", practice_prep: null }]);
  } finally { await db.close(); }
});
