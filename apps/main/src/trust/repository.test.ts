import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTrustEventsRepository } from "./repository.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const setup = () => {
  const db = new Database(":memory:");
  const migDir = join(__dirname, "../db/migrations");
  for (const f of readdirSync(migDir).sort()) {
    if (f.endsWith(".sql")) db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "c1",
    "Acme",
    Date.now(),
  );
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1','c1','A','engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?)`,
  ).run(Date.now(), Date.now());
  return { db, repo: createTrustEventsRepository(db) };
};

describe("TrustEventsRepository", () => {
  it("records a promotion and returns it via listByAgent", () => {
    const { repo } = setup();
    const ev = repo.create({
      agentId: "a1",
      kind: "promoted",
      fromTier: "novato",
      toTier: "confiavel",
      reason: "5 verified outcomes",
    });
    expect(ev.id).toMatch(/.+/);
    const list = repo.listByAgent("a1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      agentId: "a1",
      kind: "promoted",
      fromTier: "novato",
      toTier: "confiavel",
      reason: "5 verified outcomes",
    });
  });

  it("listByAgent returns most-recent first (rowid tiebreaker for same-ms inserts)", () => {
    const { repo } = setup();
    const t1 = repo.create({
      agentId: "a1",
      kind: "promoted",
      fromTier: "novato",
      toTier: "confiavel",
      reason: "first",
    });
    const t2 = repo.create({
      agentId: "a1",
      kind: "demoted",
      fromTier: "confiavel",
      toTier: "novato",
      reason: "regression",
    });
    const list = repo.listByAgent("a1");
    expect(list[0]!.id).toBe(t2.id);
    expect(list[1]!.id).toBe(t1.id);
  });
});
