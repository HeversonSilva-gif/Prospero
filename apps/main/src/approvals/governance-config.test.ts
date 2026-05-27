import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { loadGovernanceConfig, saveGovernanceConfig } from "./governance-config.js";
import { DEFAULT_GOVERNANCE_CONFIG } from "@prospero/shared";

function seed(db: Database.Database, companyId = "c1"): void {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, 'Co', 0)").run(companyId);
}

describe("governance-config repository", () => {
  it("loadGovernanceConfig returns default for a company without a row", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db);
    const cfg = loadGovernanceConfig(db, "c1");
    expect(cfg).toEqual(DEFAULT_GOVERNANCE_CONFIG);
    db.close();
  });

  it("save then load round-trips the full config", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db);
    const customized = {
      quietHours: {
        windows: [{ daysOfWeek: [1, 2, 3, 4, 5], startMinute: 22 * 60, endMinute: 8 * 60 }],
      },
      policies: {
        autoApproveReadOnlyAcrossProjects: true,
        autoApproveSpendUnderUsdPerDay: 1.5,
        ceoCanDecideFires: false,
        ceoCanDecideBudgetOverruns: true,
        bouncedToCeoTtlHours: 6,
      },
    };
    saveGovernanceConfig(db, "c1", customized);
    expect(loadGovernanceConfig(db, "c1")).toEqual(customized);
    db.close();
  });

  it("isolates configs per company", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db, "c1");
    seed(db, "c2");
    saveGovernanceConfig(db, "c1", {
      ...DEFAULT_GOVERNANCE_CONFIG,
      policies: { ...DEFAULT_GOVERNANCE_CONFIG.policies, bouncedToCeoTtlHours: 12 },
    });
    expect(loadGovernanceConfig(db, "c2").policies.bouncedToCeoTtlHours).toBe(4);
    db.close();
  });

  it("load with malformed JSON returns default (no throw)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db);
    db.prepare(
      `INSERT INTO governance_config (company_id, quiet_hours_json, policies_json, updated_at)
       VALUES ('c1', 'not json', 'also not json', 0)`,
    ).run();
    expect(loadGovernanceConfig(db, "c1")).toEqual(DEFAULT_GOVERNANCE_CONFIG);
    db.close();
  });

  it("save validates input via Zod and throws on invalid", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db);
    expect(() =>
      saveGovernanceConfig(db, "c1", {
        quietHours: {
          windows: [{ daysOfWeek: [9], startMinute: -1, endMinute: 2000 }],
        },
        policies: DEFAULT_GOVERNANCE_CONFIG.policies,
      }),
    ).toThrow();
    db.close();
  });
});
