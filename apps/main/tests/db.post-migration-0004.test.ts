import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigration0004 } from "../src/db/post-migrations/0004.js";

const setupCompany = (db: Database.Database, companyId = "c1") => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, 'Acme', 0)").run(companyId);
};

const seedAgent = (
  db: Database.Database,
  id: string,
  companyId: string,
  opts: { templateId?: string | null; capabilitiesJson?: string; reportsTo?: string | null } = {},
) => {
  db.prepare(
    `INSERT INTO agents (
      id, company_id, name, role, template_id, system_prompt, capabilities_json, allowed_projects_json,
      mode, always_on, reports_to, status, current_action, created_at, updated_at
    ) VALUES (?, ?, 'X', 'r', ?, 'sp', ?, '[]', 'supervised', 0, ?, 'idle', NULL, 0, 0)`,
  ).run(
    id,
    companyId,
    opts.templateId ?? null,
    opts.capabilitiesJson ?? "[]",
    opts.reportsTo ?? null,
  );
};

describe("postMigration 0004 — seed roles + backfill", () => {
  it("seeds the 5 canonical roles when role_templates is empty", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    runPostMigration0004(db);
    const rows = db.prepare("SELECT id, name FROM role_templates ORDER BY id").all() as Array<{
      id: string;
      name: string;
    }>;
    expect(rows.map((r) => r.id).sort()).toEqual([
      "role-ceo",
      "role-designer",
      "role-engineer",
      "role-pm",
      "role-qa",
    ]);
  });

  it("seeded CEO role has Opus model and delegation+issues+inbox+chat+fs-read skills", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    runPostMigration0004(db);
    const ceo = db
      .prepare(
        "SELECT default_model, default_capabilities_json FROM role_templates WHERE id = 'role-ceo'",
      )
      .get() as { default_model: string; default_capabilities_json: string };
    expect(ceo.default_model).toBe("claude-opus-4-7");
    expect((JSON.parse(ceo.default_capabilities_json) as string[]).sort()).toEqual([
      "chat",
      "delegation",
      "fs-read",
      "inbox",
      "issues",
    ]);
  });

  it("backfills root CEO agent (reports_to IS NULL, template_id IS NULL) with role-ceo data", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupCompany(db);
    seedAgent(db, "ceo_a", "c1", { reportsTo: null, templateId: null, capabilitiesJson: "[]" });
    runPostMigration0004(db);
    const row = db
      .prepare("SELECT template_id, capabilities_json, model FROM agents WHERE id = 'ceo_a'")
      .get() as { template_id: string; capabilities_json: string; model: string };
    expect(row.template_id).toBe("role-ceo");
    expect((JSON.parse(row.capabilities_json) as string[]).sort()).toEqual([
      "chat",
      "delegation",
      "fs-read",
      "inbox",
      "issues",
    ]);
    expect(row.model).toBe("claude-opus-4-7");
  });

  it("backfills non-root orphan agents (reports_to IS NOT NULL, template_id IS NULL) with role-engineer", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupCompany(db);
    seedAgent(db, "ceo_a", "c1", { reportsTo: null, templateId: null });
    seedAgent(db, "eng_a", "c1", { reportsTo: "ceo_a", templateId: null });
    runPostMigration0004(db);
    const row = db
      .prepare("SELECT template_id, capabilities_json, model FROM agents WHERE id = 'eng_a'")
      .get() as { template_id: string; capabilities_json: string; model: string };
    expect(row.template_id).toBe("role-engineer");
    expect((JSON.parse(row.capabilities_json) as string[]).sort()).toEqual([
      "chat",
      "fs-read",
      "fs-write",
      "issues",
      "shell",
    ]);
    expect(row.model).toBe("claude-sonnet-4-6");
  });

  it("does not overwrite an agent that already has a template_id", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupCompany(db);
    seedAgent(db, "a1", "c1", {
      templateId: "role-engineer",
      capabilitiesJson: JSON.stringify(["fs-read"]),
    });
    runPostMigration0004(db);
    const row = db
      .prepare("SELECT template_id, capabilities_json FROM agents WHERE id = 'a1'")
      .get() as {
      template_id: string;
      capabilities_json: string;
    };
    expect(row.template_id).toBe("role-engineer");
    expect(JSON.parse(row.capabilities_json) as string[]).toEqual(["fs-read"]);
  });

  it("is idempotent — second run does not duplicate roles or change agents", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    setupCompany(db);
    seedAgent(db, "ceo_a", "c1", { reportsTo: null, templateId: null });

    runPostMigration0004(db);
    runPostMigration0004(db);

    const roleCount = (
      db.prepare("SELECT COUNT(*) AS n FROM role_templates").get() as { n: number }
    ).n;
    expect(roleCount).toBe(5);

    const row = db.prepare("SELECT template_id FROM agents WHERE id = 'ceo_a'").get() as {
      template_id: string;
    };
    expect(row.template_id).toBe("role-ceo");
  });

  it("sets the done flag in settings", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    runPostMigration0004(db);
    const flag = db
      .prepare("SELECT value FROM settings WHERE key = 'post_migration_0004_done'")
      .get() as { value: string } | undefined;
    expect(flag?.value).toBe("1");
  });
});
