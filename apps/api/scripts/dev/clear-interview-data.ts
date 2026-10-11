/**
 * Clear one user's interview data (dev only). Dry run by default; `--apply` deletes.
 *
 *   pnpm exec tsx --env-file=.env scripts/dev/clear-interview-data.ts <email-or-fragment> [--apply]
 *
 * Removes: the user's interview sessions (Postgres), the problems already given to them (`blueprint_seen`), and the AI
 * service's blueprints, blueprint runs and live-interview runs/turns/briefs/evidence (same filters as its
 * `POST /users/purge`, applied straight to its Mongo database so the AI service need not be running).
 * Keeps: the account, profile and sources, targets, saved processes and loops (loop dashboards start empty again).
 */
import { and, eq, inArray } from "drizzle-orm";
import { loadConfig } from "../../src/config.js";
import { collections, connectMongo } from "../../src/db/mongo/client.js";
import { createDatabase, createPgPool } from "../../src/db/pg/client.js";
import { interviewSessions } from "../../src/db/pg/schema.js";
import { BlueprintSeenRepository } from "../../src/repositories/mongo.js";
import { InterviewSessionRepository, UserRepository } from "../../src/repositories/pg.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const needle = args.find((a) => !a.startsWith("--"))?.toLowerCase();
if (!needle) {
  console.error("usage: clear-interview-data.ts <email-or-fragment> [--apply]");
  process.exit(2);
}

const AI_COLLECTIONS = ["interview_blueprints", "blueprint_runs", "live_runs", "live_turns", "live_briefs", "live_evidence"] as const;

const config = loadConfig();
const pool = createPgPool(config.postgres);
const db = createDatabase(pool);
const mongo = await connectMongo(config.mongo.uri, config.mongo.database);
async function run(needle: string): Promise<void> {
  const seenRepo = new BlueprintSeenRepository(collections(mongo.db));
  const matches = (await new UserRepository(db).findAll()).filter((u) => u.email.toLowerCase().includes(needle));
  if (matches.length !== 1) {
    console.log(matches.length === 0 ? `no user matches "${needle}"` : `ambiguous, ${matches.length} users match "${needle}":`);
    for (const u of matches) console.log(`  ${u.id}  ${u.email}`);
    return;
  }
  const user = matches[0]!;
  const sessions = await new InterviewSessionRepository(db).findAllByCandidateIdOrderByScheduledAtDesc(user.id);
  const sessionIds = sessions.map((s) => s.id);
  console.log(`user ${user.id}  ${user.email}`);
  console.log(`interview_sessions: ${sessions.length}`);
  for (const s of sessions) console.log(`  ${s.id}  ${s.status.padEnd(18)} ${s.company} / ${s.role} / ${s.roundType}  ${s.scheduledAt.toISOString()}`);

  const live = sessions.filter((s) => s.status === "LIVE_IN_PROGRESS");
  if (live.length > 0) {
    console.log("refusing: a session is LIVE_IN_PROGRESS, end it first");
    return;
  }

  const ai = mongo.client.db(process.env.AI_MONGODB_DATABASE ?? "interviewiq_intelligence");
  const filter = { $or: [{ candidate_id: user.id }, { session_id: { $in: sessionIds } }] };
  const seenCount = await collections(mongo.db).blueprintSeen.countDocuments({ candidateId: user.id });
  console.log(`blueprint_seen: ${seenCount}`);
  const aiCounts: Record<string, number> = {};
  for (const name of AI_COLLECTIONS) {
    aiCounts[name] = await ai.collection(name).countDocuments(filter);
    console.log(`${ai.databaseName}.${name}: ${aiCounts[name]}`);
  }

  if (!apply) {
    console.log("dry run, nothing deleted. Re-run with --apply.");
    return;
  }

  // AI-service data first, then the API's own: a crash mid-way leaves rows a retry converges on.
  for (const name of AI_COLLECTIONS) {
    const r = await ai.collection(name).deleteMany(filter);
    console.log(`deleted ${r.deletedCount} from ${name}`);
  }
  await seenRepo.deleteByCandidate(user.id);
  console.log("deleted blueprint_seen");
  if (sessionIds.length > 0) {
    const rows = await db
      .delete(interviewSessions)
      .where(and(eq(interviewSessions.candidateId, user.id), inArray(interviewSessions.id, sessionIds)))
      .returning({ id: interviewSessions.id });
    console.log(`deleted ${rows.length} interview_sessions`);
  }
}

try {
  await run(needle);
} finally {
  await Promise.allSettled([pool.end(), mongo.client.close()]);
}
