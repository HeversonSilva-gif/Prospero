import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createGuardrailAlert } from "./guardrail-alert.js";
import { createInboxRepository } from "../inbox/repository.js";

describe("createGuardrailAlert", () => {
  it("creates a security_alert inbox row and dedups within the window", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const args = {
      companyId: "co_1",
      actorId: "ag_1",
      title: "Cap atingido",
      preview: "post_to_x",
    };
    const first = createGuardrailAlert(db, args);
    const second = createGuardrailAlert(db, args); // within window → deduped
    expect(first).toBe(true);
    expect(second).toBe(false);
    const items = createInboxRepository(db)
      .listByCompany("co_1")
      .filter((i) => i.kind === "security_alert");
    expect(items.length).toBe(1);
  });

  it("never throws on a bad db", () => {
    const db = new Database(":memory:"); // no migrations → table missing
    expect(() =>
      createGuardrailAlert(db, { companyId: "c", actorId: "a", title: "t", preview: "p" }),
    ).not.toThrow();
  });
});
