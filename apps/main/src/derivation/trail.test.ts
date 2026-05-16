import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { buildIssueTrail, buildRecoveryTrail } from "./trail.js";
import { buildIssuePrompt, buildRecoveryPrompt } from "./prompts.js";

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

describe("buildIssueTrail", () => {
  it("returns the issue with its comments oldest-first", () => {
    const db = seed();
    db.prepare(
      `INSERT INTO issues (id, company_id, title, description, status, priority, created_at, updated_at)
       VALUES ('i1','c1','Fix the redis timeout','it flakes under load','done','high',0,0)`,
    ).run();
    db.prepare(
      `INSERT INTO issue_comments (id, issue_id, sender_kind, sender_id, content, created_at)
       VALUES ('cm1','i1','agent','a1','raised the pool size',10),
              ('cm2','i1','agent','a1','added a retry',20)`,
    ).run();
    const trail = buildIssueTrail(db, "i1");
    expect(trail?.title).toBe("Fix the redis timeout");
    expect(trail?.comments.map((c) => c.content)).toEqual([
      "raised the pool size",
      "added a retry",
    ]);
  });

  it("returns null for an unknown issue", () => {
    expect(buildIssueTrail(seed(), "nope")).toBeNull();
  });
});

describe("buildRecoveryTrail", () => {
  it("returns the agent's most recent messages oldest-first", () => {
    const db = seed();
    db.prepare(
      "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES ('t1','c1','user|a1',0)",
    ).run();
    db.prepare(
      `INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, kind, tool_calls_json, created_at)
       VALUES ('m1','t1','agent','a1','first','message',NULL,10),
              ('m2','t1','agent','a1','second','message',NULL,20)`,
    ).run();
    const trail = buildRecoveryTrail(db, "a1", 10);
    expect(trail?.agentName).toBe("Eng");
    expect(trail?.messages.map((m) => m.content)).toEqual(["first", "second"]);
  });

  it("returns null for an unknown agent", () => {
    expect(buildRecoveryTrail(seed(), "nope", 10)).toBeNull();
  });
});

describe("prompts", () => {
  it("buildIssuePrompt embeds the trail and asks for DISCARD-or-JSON", () => {
    const p = buildIssuePrompt({
      issueId: "i1",
      identifier: "ENG-1",
      title: "Fix the redis timeout",
      description: "flakes",
      comments: [{ sender: "agent", content: "raised the pool size" }],
    });
    expect(p).toContain("Fix the redis timeout");
    expect(p).toContain("raised the pool size");
    expect(p).toContain("DISCARD");
    expect(p).toContain("```json");
  });

  it("buildRecoveryPrompt embeds the messages", () => {
    const p = buildRecoveryPrompt({
      agentId: "a1",
      agentName: "Eng",
      role: "engineer",
      messages: [{ sender: "agent", content: "second" }],
    });
    expect(p).toContain("second");
    expect(p).toContain("DISCARD");
  });
});
