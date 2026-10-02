import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../../src/db/pg/client.js";

/** A copy of the migrations folder whose journal stops just BEFORE `tag`. */
function migrationsBefore(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "iq-migrations-"));
  cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === tag));
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("0002_company_research", () => {
  it("publishes every company that existed before research, so none disappears for students", async () => {
    const client = new PGlite();
    try {
      await migrate(drizzle(client), { migrationsFolder: migrationsBefore("0002_company_research") });
      await client.query(
        `insert into companies (id, name, slug, tier, created_at) values (gen_random_uuid(), 'Meesho', 'meesho', 2, '2026-01-01T00:00:00Z')`,
      );
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
      const { rows } = await client.query<{ published_at: Date; origin: string; status: string; aliases: string[] }>(
        "select published_at, origin, status, aliases from companies",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.published_at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(rows[0]).toMatchObject({ origin: "seed", status: "active", aliases: [] });
    } finally {
      await client.close();
    }
  });
});
