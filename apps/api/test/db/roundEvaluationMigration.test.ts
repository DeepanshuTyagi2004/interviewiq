import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../../src/db/pg/client.js";

it("round-evaluation migration adds the grading columns and marks existing COMPLETED rounds legacy", async () => {
  const db = new PGlite();
  try {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    for (const e of journal.entries.filter((x) => x.idx < 11)) await db.exec(readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), "utf8"));
    const done = randomUUID();
    const open = randomUUID();
    const insert = (id: string, status: string) => db.query(
      "insert into interview_sessions (id,candidate_id,company,role,level,round_type,scheduled_at,timezone,status,created_at,updated_at) values ($1,$2,'google','swe','sde1','dsa',now(),'UTC',$3,now(),now())",
      [id, randomUUID(), status]);
    await insert(done, "COMPLETED");
    await insert(open, "PREP_READY");
    const entry = journal.entries.find((x) => x.idx === 11)!;
    expect(entry.tag).toBe("0011_round_evaluation");
    await db.exec(readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), "utf8"));

    const cols = (await db.query("select column_name from information_schema.columns where table_name='interview_sessions'")).rows.map((r) => (r as { column_name: string }).column_name);
    for (const c of ["pass_mark", "code_standard", "company_tier", "round_difficulty", "eval_status", "eval_run_id", "eval_run_started_at", "eval_attempts",
      "eval_retry_window_start", "eval_error_code", "score", "eval_outcome", "verdict", "retake_after", "eval_version", "evaluated_at"]) expect(cols).toContain(c);
    expect((await db.query("select column_name from information_schema.columns where table_name='companies' and column_name='code_standard'")).rows).toHaveLength(1);
    const rows = (await db.query("select id,eval_status,eval_attempts from interview_sessions")).rows as { id: string; eval_status: string | null; eval_attempts: number }[];
    expect(rows.find((r) => r.id === done)).toMatchObject({ eval_status: "legacy", eval_attempts: 0 });
    expect(rows.find((r) => r.id === open)?.eval_status).toBeNull();
    expect((await db.query("select indexname from pg_indexes where indexname='idx_session_eval_status'")).rows).toHaveLength(1);
  } finally { await db.close(); }
});
