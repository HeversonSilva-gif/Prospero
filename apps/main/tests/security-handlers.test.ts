import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../src/db/migrations.js";
import { securityHandlers } from "../src/ipc/security-handlers.js";
import { createCompaniesRepository } from "../src/companies/repository.js";

const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const userDataDir = mkdtempSync(join(tmpdir(), "security-zones-"));
  tmps.push(userDataDir);
  return { db, h: securityHandlers({ db, userDataDir }), userDataDir };
};

const seedAgent = (db: Database.Database, id: string, companyId: string, name: string): void => {
  const now = Date.now();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES (?, ?, ?, 'engineer', '', '[]', '[]', 'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', ?, ?)`,
  ).run(id, companyId, name, now, now);
};

describe("securityHandlers.listZones", () => {
  it("returns an empty list when there are no companies", () => {
    const { h } = setup();
    expect(h.listZones()).toEqual([]);
  });

  it("returns one company zone per company plus one agent zone per agent", () => {
    const { db, h, userDataDir } = setup();
    const repo = createCompaniesRepository(db);
    const c1 = repo.create({ name: "Acme" });
    const c2 = repo.create({ name: "Beta" });
    seedAgent(db, "a1", c1.id, "Reviewer");
    seedAgent(db, "a2", c1.id, "Builder");
    seedAgent(db, "a3", c2.id, "Solo");

    const zones = h.listZones();
    // 2 companies + 3 agents = 5 entries
    expect(zones).toHaveLength(5);

    const c1Zone = zones.find((z) => z.kind === "company" && z.companyId === c1.id);
    expect(c1Zone).toMatchObject({
      kind: "company",
      companyId: c1.id,
      companyName: "Acme",
      samplePath: join(userDataDir, "companies", c1.id),
    });

    const a1Zone = zones.find((z) => z.kind === "agent" && z.agentId === "a1");
    expect(a1Zone).toMatchObject({
      kind: "agent",
      companyId: c1.id,
      companyName: "Acme",
      agentId: "a1",
      agentName: "Reviewer",
      samplePath: join(userDataDir, "companies", c1.id, "agents", "a1"),
    });

    // Agents from c2 follow c2's company row, not c1's, in iteration order.
    const c2Index = zones.findIndex((z) => z.kind === "company" && z.companyId === c2.id);
    const a3Index = zones.findIndex((z) => z.kind === "agent" && z.agentId === "a3");
    expect(a3Index).toBeGreaterThan(c2Index);
  });

  it("excludes terminated agents", () => {
    const { db, h } = setup();
    const c1 = createCompaniesRepository(db).create({ name: "Acme" });
    seedAgent(db, "alive", c1.id, "Alive");
    seedAgent(db, "gone", c1.id, "Gone");
    db.prepare("UPDATE agents SET terminated_at = ? WHERE id = ?").run(Date.now(), "gone");

    const zones = h.listZones();
    expect(zones.filter((z) => z.kind === "agent")).toHaveLength(1);
    expect(zones.find((z) => z.kind === "agent")?.agentId).toBe("alive");
  });
});
