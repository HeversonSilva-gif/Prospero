import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createGuardrailAlert } from "./guardrail-alert.js";
import { createInboxRepository } from "../inbox/repository.js";

const seedCompanyAgent = (db: Database.Database) => {
  db.prepare(`INSERT INTO companies (id, name, created_at) VALUES ('co_1','C',1)`).run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at) VALUES ('ag_1','co_1','A','worker','',1,1)`,
  ).run();
};

describe("createGuardrailAlert", () => {
  it("creates a security_alert and dedups within the window (per real agent)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompanyAgent(db);
    const args = {
      companyId: "co_1",
      actorId: "ag_1",
      title: "Cap atingido",
      preview: "post_to_x",
    };
    expect(createGuardrailAlert(db, args)).toBe(true);
    expect(createGuardrailAlert(db, args)).toBe(false); // deduped
    const items = createInboxRepository(db)
      .listByCompany("co_1")
      .filter((i) => i.kind === "security_alert");
    expect(items.length).toBe(1);
  });

  it("creates content alerts with a null actor (no per-agent dedup)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompanyAgent(db);
    const args = {
      companyId: "co_1",
      actorId: null,
      title: "E-mail bloqueado",
      preview: "injection",
    };
    expect(createGuardrailAlert(db, args)).toBe(true);
    expect(createGuardrailAlert(db, args)).toBe(true); // null actor → not deduped
    const items = createInboxRepository(db)
      .listByCompany("co_1")
      .filter((i) => i.kind === "security_alert");
    expect(items.length).toBe(2);
  });

  it("never throws on a bad db", () => {
    const db = new Database(":memory:"); // no migrations → table missing
    expect(() =>
      createGuardrailAlert(db, { companyId: "c", actorId: null, title: "t", preview: "p" }),
    ).not.toThrow();
  });
});
