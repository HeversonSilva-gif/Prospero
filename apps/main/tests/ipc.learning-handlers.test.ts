import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../src/db/migrations.js";
import { createSkillsRepository } from "../src/memory/skills-repository.js";
import { createMemoriesRepository } from "../src/memory/memories-repository.js";
import { learningHandlers, toFtsMatchExpr } from "../src/ipc/learning-handlers.js";
import { createSkillCandidatesRepository } from "../src/memory/skill-candidates-repository.js";
import { createInboxRepository } from "../src/inbox/repository.js";

const USERDATA = mkdtempSync(join(tmpdir(), "prospero-lh-ud-"));

const seed = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  return db;
};

describe("toFtsMatchExpr", () => {
  it("quotes a single term", () => {
    expect(toFtsMatchExpr("redis")).toBe('"redis"');
  });
  it("quotes every whitespace-separated term (implicit AND)", () => {
    expect(toFtsMatchExpr("redis outage")).toBe('"redis" "outage"');
  });
  it("escapes embedded double quotes", () => {
    expect(toFtsMatchExpr('say "hi"')).toBe('"say" """hi"""');
  });
  it("returns an empty string for blank input", () => {
    expect(toFtsMatchExpr("   ")).toBe("");
  });
});

describe("learningHandlers", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
  });

  it("listSkills returns the agent's private skills and company-shared skills", () => {
    const repo = createSkillsRepository(db);
    repo.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath: "p1",
      description: "private deploy skill",
      source: "agent_created",
    });
    repo.create({
      companyId: "c1",
      agentId: null,
      name: "code-review",
      bodyPath: "p2",
      description: "shared review skill",
      source: "user_authored",
    });
    const skills = learningHandlers(db, USERDATA).listSkills({ agentId: "a1" });
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["code-review", "deploy"]);
    expect(skills.find((s) => s.name === "code-review")?.agentId).toBeNull();
  });

  it("listSkills returns [] for an unknown agent", () => {
    expect(learningHandlers(db, USERDATA).listSkills({ agentId: "nope" })).toEqual([]);
  });

  it("readSkillBody returns the SKILL.md file content", () => {
    const dir = mkdtempSync(join(tmpdir(), "prospero-lh-"));
    const bodyPath = join(dir, "SKILL.md");
    writeFileSync(bodyPath, "# Deploy\n1. build\n2. ship", "utf8");
    const skill = createSkillsRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath,
      description: "d",
      source: "agent_created",
    });
    const out = learningHandlers(db, USERDATA).readSkillBody({ skillId: skill.id });
    expect(out.body).toContain("2. ship");
    rmSync(dir, { recursive: true, force: true });
  });

  it("readSkillBody throws for an unknown skill id", () => {
    expect(() =>
      learningHandlers(db, USERDATA).readSkillBody({ skillId: "skill_missing" }),
    ).toThrow(/not found/i);
  });

  it("listMemories returns the agent's memory rows", () => {
    createMemoriesRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "always lint before commit",
    });
    const memories = learningHandlers(db, USERDATA).listMemories({ agentId: "a1" });
    expect(memories).toHaveLength(1);
    expect(memories[0]?.body).toBe("always lint before commit");
  });

  it("searchSessions finds an agent's past messages by keyword", () => {
    db.prepare(
      "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES ('t1','c1','user|a1',0)",
    ).run();
    db.prepare(
      `INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, kind, tool_calls_json, created_at)
       VALUES ('m1','t1','user',NULL,'investigate the redis outage','message',NULL,10)`,
    ).run();
    db.prepare(
      "INSERT INTO messages_fts (message_id, content) VALUES ('m1','investigate the redis outage')",
    ).run();
    const hits = learningHandlers(db, USERDATA).searchSessions({ agentId: "a1", query: "redis" });
    expect(hits.map((h) => h.messageId)).toEqual(["m1"]);
    expect(hits[0]?.senderKind).toBe("user");
  });

  it("searchSessions excludes messages from threads the agent is not in", () => {
    db.prepare(
      "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES ('t2','c1','user|other',0)",
    ).run();
    db.prepare(
      `INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, kind, tool_calls_json, created_at)
       VALUES ('m2','t2','user',NULL,'unrelated redis chatter','message',NULL,10)`,
    ).run();
    db.prepare(
      "INSERT INTO messages_fts (message_id, content) VALUES ('m2','unrelated redis chatter')",
    ).run();
    expect(
      learningHandlers(db, USERDATA).searchSessions({ agentId: "a1", query: "redis" }),
    ).toEqual([]);
  });

  it("searchSessions returns [] for a blank query", () => {
    expect(learningHandlers(db, USERDATA).searchSessions({ agentId: "a1", query: "  " })).toEqual(
      [],
    );
  });
});

describe("learningHandlers — candidates", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
    db.prepare(
      `INSERT INTO activity_events (id, company_id, actor_kind, actor_id, action, entity_kind,
         entity_id, agent_id, payload_json, created_at)
       VALUES ('evt_1','c1','agent','a1','issue.status_changed','issue','i1','a1','{}',0)`,
    ).run();
  });

  const seedCandidate = (): string => {
    const candidate = createSkillCandidatesRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      sourceEventId: "evt_1",
      trigger: "issue_done",
      proposedName: "deploy-runbook",
      proposedDescription: "how to deploy",
      proposedBody: "1. build\n2. ship",
    });
    return candidate.id;
  };

  it("listCandidates returns the agent's pending candidates", () => {
    seedCandidate();
    const list = learningHandlers(db, USERDATA).listCandidates({ agentId: "a1" });
    expect(list).toHaveLength(1);
    expect(list[0]?.proposedName).toBe("deploy-runbook");
  });

  it("acceptCandidate creates a skill and clears the candidate from the pending list", () => {
    const candidateId = seedCandidate();
    const h = learningHandlers(db, USERDATA);
    const skill = h.acceptCandidate({ candidateId });
    expect(skill.name).toBe("deploy-runbook");
    expect(h.listCandidates({ agentId: "a1" })).toHaveLength(0);
    expect(h.listSkills({ agentId: "a1" }).map((s) => s.name)).toContain("deploy-runbook");
  });

  it("acceptCandidate applies overrides", () => {
    const candidateId = seedCandidate();
    const h = learningHandlers(db, USERDATA);
    const skill = h.acceptCandidate({ candidateId, name: "renamed-skill", body: "new body" });
    expect(skill.name).toBe("renamed-skill");
  });

  it("rejectCandidate clears the candidate from the pending list", () => {
    const candidateId = seedCandidate();
    const h = learningHandlers(db, USERDATA);
    expect(h.rejectCandidate({ candidateId })).toEqual({ ok: true });
    expect(h.listCandidates({ agentId: "a1" })).toHaveLength(0);
  });
});

describe("learningHandlers — skill promotion", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = seed();
  });

  it("approveSkillPromotion promotes the skill and resolves the inbox item", () => {
    const skills = createSkillsRepository(db);
    const skill = skills.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    createInboxRepository(db).create({
      companyId: "c1",
      kind: "skill_promotion_requested",
      title: "Promote deploy",
      requiresAction: true,
      payloadJson: JSON.stringify({ skillId: skill.id }),
    });
    const h = learningHandlers(db, USERDATA);
    const result = h.approveSkillPromotion({ skillId: skill.id, appliesToRole: "engineer" });
    expect(result.agentId).toBeNull();
    expect(result.promoted).toBe(true);
    expect(result.appliesToRole).toBe("engineer");
    const unread = (
      db.prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE read_at IS NULL").get() as {
        n: number;
      }
    ).n;
    expect(unread).toBe(0);
  });

  it("approveSkillPromotion accepts a null role (company-global)", () => {
    const skill = createSkillsRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      name: "x",
      bodyPath: "p",
      description: "d",
      source: "agent_created",
    });
    const result = learningHandlers(db, USERDATA).approveSkillPromotion({
      skillId: skill.id,
      appliesToRole: null,
    });
    expect(result.appliesToRole).toBeNull();
  });
});
