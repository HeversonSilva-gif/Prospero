import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../db/migrations.js";
import { createSkillCandidatesRepository } from "./skill-candidates-repository.js";
import { createSkillsRepository } from "./skills-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { acceptSkillCandidate, rejectSkillCandidate } from "./review-candidate.js";

let userDataDir: string;

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  db.prepare(
    `INSERT INTO activity_events (id, company_id, actor_kind, actor_id, action, entity_kind,
       entity_id, agent_id, payload_json, created_at)
     VALUES ('evt_1','c1','agent','a1','issue.status_changed','issue','i1','a1','{}',0)`,
  ).run();
  return db;
};

const seedCandidate = (db: Database.Database): string => {
  const candidate = createSkillCandidatesRepository(db).create({
    companyId: "c1",
    agentId: "a1",
    sourceEventId: "evt_1",
    trigger: "issue_done",
    proposedName: "redis-pool-tuning",
    proposedDescription: "how to raise the pool",
    proposedBody: "1. measure\n2. raise",
  });
  createInboxRepository(db).create({
    companyId: "c1",
    kind: "skill_candidate_pending",
    title: "New skill candidate",
    requiresAction: true,
    payloadJson: JSON.stringify({ candidateId: candidate.id }),
  });
  return candidate.id;
};

const inboxUnreadCount = (db: Database.Database): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE read_at IS NULL").get() as { n: number })
    .n;

describe("acceptSkillCandidate", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
    userDataDir = mkdtempSync(join(tmpdir(), "prospero-rc-"));
  });

  it("creates a skill, writes the SKILL.md, marks the candidate accepted, resolves the inbox", () => {
    const candidateId = seedCandidate(db);
    const skill = acceptSkillCandidate(db, userDataDir, { candidateId, reviewedBy: "user" });
    expect(skill.name).toBe("redis-pool-tuning");
    expect(skill.source).toBe("derived_from_issue");
    expect(skill.agentId).toBe("a1");
    expect(readFileSync(skill.bodyPath, "utf8")).toContain("2. raise");
    expect(createSkillsRepository(db).getById(skill.id)?.description).toBe("how to raise the pool");
    expect(createSkillCandidatesRepository(db).getById(candidateId)?.status).toBe("accepted");
    expect(inboxUnreadCount(db)).toBe(0);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("applies name/description/body overrides (the Edit flow)", () => {
    const candidateId = seedCandidate(db);
    const skill = acceptSkillCandidate(db, userDataDir, {
      candidateId,
      reviewedBy: "user",
      name: "edited-name",
      description: "edited desc",
      body: "edited body",
    });
    expect(skill.name).toBe("edited-name");
    expect(skill.description).toBe("edited desc");
    expect(readFileSync(skill.bodyPath, "utf8")).toBe("edited body");
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("throws for an unknown candidate", () => {
    expect(() =>
      acceptSkillCandidate(db, userDataDir, { candidateId: "cand_missing", reviewedBy: "user" }),
    ).toThrow(/not found/i);
  });

  it("throws when the candidate is already reviewed", () => {
    const candidateId = seedCandidate(db);
    acceptSkillCandidate(db, userDataDir, { candidateId, reviewedBy: "user" });
    expect(() =>
      acceptSkillCandidate(db, userDataDir, { candidateId, reviewedBy: "user" }),
    ).toThrow(/already/i);
  });
});

describe("rejectSkillCandidate", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
  });

  it("marks the candidate rejected, stores the reason, and resolves the inbox", () => {
    const candidateId = seedCandidate(db);
    rejectSkillCandidate(db, { candidateId, reviewedBy: "user", reason: "too narrow" });
    const candidate = createSkillCandidatesRepository(db).getById(candidateId);
    expect(candidate?.status).toBe("rejected");
    expect(candidate?.rejectReason).toBe("too narrow");
    expect(inboxUnreadCount(db)).toBe(0);
  });

  it("throws when the candidate is already reviewed", () => {
    const candidateId = seedCandidate(db);
    rejectSkillCandidate(db, { candidateId, reviewedBy: "user" });
    expect(() => rejectSkillCandidate(db, { candidateId, reviewedBy: "user" })).toThrow(/already/i);
  });
});
