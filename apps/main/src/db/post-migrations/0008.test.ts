import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../migrations.js";
import { runPostMigration0008 } from "./0008.js";

// Audit 2026-06-03 Inteligência & Contexto I4: bumps role_templates rows off the
// retired claude-opus-4-7 onto claude-opus-4-8.

const insertRole = (db: Database.Database, id: string, model: string): void => {
  db.prepare(
    `INSERT INTO role_templates (id, name, description, default_system_prompt, default_capabilities_json, icon, default_model)
     VALUES (?, ?, '', '', '[]', NULL, ?)`,
  ).run(id, id, model);
};

const modelOf = (db: Database.Database, id: string): string =>
  (
    db.prepare("SELECT default_model FROM role_templates WHERE id = ?").get(id) as {
      default_model: string;
    }
  ).default_model;

describe("runPostMigration0008", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
  });

  it("bumps role_templates default_model from claude-opus-4-7 to claude-opus-4-8", () => {
    insertRole(db, "role-ceo", "claude-opus-4-7");
    runPostMigration0008(db);
    expect(modelOf(db, "role-ceo")).toBe("claude-opus-4-8");
  });

  it("leaves rows on other models untouched", () => {
    insertRole(db, "role-engineer", "claude-sonnet-4-6");
    insertRole(db, "role-designer", "claude-haiku-4-5-20251001");
    runPostMigration0008(db);
    expect(modelOf(db, "role-engineer")).toBe("claude-sonnet-4-6");
    expect(modelOf(db, "role-designer")).toBe("claude-haiku-4-5-20251001");
  });

  it("is idempotent — a second run does not throw", () => {
    insertRole(db, "role-ceo", "claude-opus-4-7");
    runPostMigration0008(db);
    expect(() => runPostMigration0008(db)).not.toThrow();
    expect(modelOf(db, "role-ceo")).toBe("claude-opus-4-8");
  });

  it("sets the done flag in settings", () => {
    runPostMigration0008(db);
    const flag = db
      .prepare("SELECT value FROM settings WHERE key = 'post_migration_0008_done'")
      .get() as { value: string } | undefined;
    expect(flag?.value).toBe("1");
  });
});
