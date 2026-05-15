import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createSkillCandidatesRepository } from "./skill-candidates-repository.js";

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  db.prepare(
    `INSERT INTO activity_events (id, company_id, actor_kind, action, entity_kind, entity_id, payload_json, created_at)
     VALUES ('act_1','c1','system','issue.status_changed','issue','i1','{}',0)`,
  ).run();
  return db;
};

const baseInput = () => ({
  companyId: "c1",
  agentId: "a1",
  sourceEventId: "act_1",
  trigger: "issue_done" as const,
  proposedName: "deploy-runbook",
  proposedDescription: "How to deploy",
  proposedBody: "1. build 2. ship",
});

describe("skillCandidatesRepository", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = newDb();
  });

  it("create persists a pending candidate with a cand_ id", () => {
    const repo = createSkillCandidatesRepository(db);
    const c = repo.create(baseInput());
    expect(c.id).toMatch(/^cand_/);
    expect(c.status).toBe("pending");
    expect(c.proposedName).toBe("deploy-runbook");
  });

  it("listPending returns only pending candidates", () => {
    const repo = createSkillCandidatesRepository(db);
    const a = repo.create(baseInput());
    repo.create(baseInput());
    repo.updateStatus(a.id, "accepted", "user");
    expect(repo.listPending("c1").length).toBe(1);
  });

  it("updateStatus to accepted records reviewer and timestamp", () => {
    const repo = createSkillCandidatesRepository(db);
    const c = repo.create(baseInput());
    const accepted = repo.updateStatus(c.id, "accepted", "user");
    expect(accepted.status).toBe("accepted");
    expect(accepted.reviewedBy).toBe("user");
    expect(accepted.reviewedAt).not.toBeNull();
  });

  it("updateStatus to rejected stores the reject reason", () => {
    const repo = createSkillCandidatesRepository(db);
    const c = repo.create(baseInput());
    const rejected = repo.updateStatus(c.id, "rejected", "user", "too vague");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectReason).toBe("too vague");
  });
});
