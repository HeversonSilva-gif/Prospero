import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "./../migrations.js";

describe("migration 0061 — derivation_attempts", () => {
  it("creates derivation_attempts with expected columns", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(derivation_attempts)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    // trigger_class added in 0064 (segments the success/failure daily budgets).
    expect(cols).toEqual(expect.arrayContaining(["agent_id", "day_utc", "trigger_class", "count"]));
  });

  it("round-trips an insert and upsert increment", () => {
    const db = new Database(":memory:");
    applyMigrations(db);

    // First attempt: insert with count=1.
    db.prepare(
      `INSERT INTO derivation_attempts (agent_id, day_utc, count)
       VALUES ('a1', 1748736000000, 1)
       ON CONFLICT(agent_id, day_utc, trigger_class) DO UPDATE SET count = count + 1`,
    ).run();

    const row1 = db.prepare(`SELECT count FROM derivation_attempts WHERE agent_id='a1'`).get() as {
      count: number;
    };
    expect(row1.count).toBe(1);

    // Second attempt: upsert increments count.
    db.prepare(
      `INSERT INTO derivation_attempts (agent_id, day_utc, count)
       VALUES ('a1', 1748736000000, 1)
       ON CONFLICT(agent_id, day_utc, trigger_class) DO UPDATE SET count = count + 1`,
    ).run();

    const row2 = db.prepare(`SELECT count FROM derivation_attempts WHERE agent_id='a1'`).get() as {
      count: number;
    };
    expect(row2.count).toBe(2);
  });

  it("keeps separate rows for different agents and days", () => {
    const db = new Database(":memory:");
    applyMigrations(db);

    db.prepare(
      `INSERT INTO derivation_attempts (agent_id, day_utc, count) VALUES ('a1', 1000, 2)`,
    ).run();
    db.prepare(
      `INSERT INTO derivation_attempts (agent_id, day_utc, count) VALUES ('a2', 1000, 5)`,
    ).run();
    db.prepare(
      `INSERT INTO derivation_attempts (agent_id, day_utc, count) VALUES ('a1', 2000, 1)`,
    ).run();

    const rows = db
      .prepare(
        `SELECT agent_id, day_utc, count FROM derivation_attempts ORDER BY agent_id, day_utc`,
      )
      .all() as Array<{ agent_id: string; day_utc: number; count: number }>;

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ agent_id: "a1", day_utc: 1000, count: 2 });
    expect(rows[1]).toMatchObject({ agent_id: "a1", day_utc: 2000, count: 1 });
    expect(rows[2]).toMatchObject({ agent_id: "a2", day_utc: 1000, count: 5 });
  });
});
