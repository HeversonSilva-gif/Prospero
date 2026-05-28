import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";

describe("migration 0043 — curator skill lifecycle", () => {
  it("adds lifecycle_state, view_count, patch_count, lifecycle_changed_at", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const cols = (db.prepare("PRAGMA table_info(skills)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("lifecycle_state");
    expect(cols).toContain("view_count");
    expect(cols).toContain("patch_count");
    expect(cols).toContain("lifecycle_changed_at");
    db.close();
  });

  it("defaults lifecycle_state to 'active' and counters to 0", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare(`INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Co', 0)`).run();
    db.prepare(
      `INSERT INTO skills (id, company_id, agent_id, name, body_path, description,
        version, applies_to_role, source, trust, use_count, last_used, promoted,
        created_at, soft_deleted)
       VALUES ('s1','c1',NULL,'n','/p','d',1,NULL,'user_authored',0.5,0,NULL,0,0,0)`,
    ).run();
    const row = db.prepare("SELECT * FROM skills WHERE id='s1'").get() as Record<string, unknown>;
    expect(row["lifecycle_state"]).toBe("active");
    expect(row["view_count"]).toBe(0);
    expect(row["patch_count"]).toBe(0);
    expect(row["lifecycle_changed_at"]).toBeNull();
    db.close();
  });
});
