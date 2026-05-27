import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import {
  handleGovernanceGet,
  handleGovernanceUpdate,
  handleGovernanceIsQuietNow,
} from "../src/ipc/governance-handlers.js";
import { DEFAULT_GOVERNANCE_CONFIG } from "@prospero/shared";

function seedCompany(db: Database.Database, id = "c1"): void {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, 'Co', 0)").run(id);
}

describe("governance IPC handlers", () => {
  it("GET returns default for a company without saved config", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);
    expect(handleGovernanceGet(db, "c1")).toEqual(DEFAULT_GOVERNANCE_CONFIG);
    db.close();
  });

  it("UPDATE saves and returns normalized config", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);
    const input = {
      ...DEFAULT_GOVERNANCE_CONFIG,
      policies: { ...DEFAULT_GOVERNANCE_CONFIG.policies, bouncedToCeoTtlHours: 8 },
    };
    const out = handleGovernanceUpdate(db, "c1", input);
    expect(out.policies.bouncedToCeoTtlHours).toBe(8);
    expect(handleGovernanceGet(db, "c1").policies.bouncedToCeoTtlHours).toBe(8);
    db.close();
  });

  it("UPDATE rejects invalid config via Zod throw", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);
    expect(() =>
      handleGovernanceUpdate(db, "c1", {
        ...DEFAULT_GOVERNANCE_CONFIG,
        quietHours: { windows: [{ daysOfWeek: [9], startMinute: -1, endMinute: 99999 }] },
      }),
    ).toThrow();
    db.close();
  });

  it("IS_QUIET_NOW returns false when no windows configured", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seedCompany(db);
    expect(handleGovernanceIsQuietNow(db, "c1")).toBe(false);
    db.close();
  });
});
