import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { getToolHistory } from "../src/issues/tool-history.js";

describe("getToolHistory", () => {
  it("returns empty when issue never reached doing", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.pragma("foreign_keys = OFF");
    const c = createCompaniesRepository(db).create({ name: "X" });
    const a = createAgentsRepository(db).create({
      companyId: c.id,
      name: "A",
      role: "x",
      systemPrompt: "x",
      mode: "auto",
      alwaysOn: false,
    });
    const i = createIssuesRepository(db).create({
      companyId: c.id,
      projectId: null,
      title: "T",
      description: null,
      assigneeId: a.id,
      priority: "low",
      parentId: null,
      createdBy: null,
    });
    expect(getToolHistory(db, i.id)).toEqual([]);
  });

  it("returns assignee's tool calls inside doing window", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.pragma("foreign_keys = OFF");
    const c = createCompaniesRepository(db).create({ name: "X" });
    const a = createAgentsRepository(db).create({
      companyId: c.id,
      name: "A",
      role: "x",
      systemPrompt: "x",
      mode: "auto",
      alwaysOn: false,
    });
    const issuesRepo = createIssuesRepository(db);
    const i = issuesRepo.create({
      companyId: c.id,
      projectId: null,
      title: "T",
      description: null,
      assigneeId: a.id,
      priority: "low",
      parentId: null,
      createdBy: null,
    });
    issuesRepo.update(i.id, { status: "doing" }, { actorKind: "user", actorId: null });
    const startTime = Date.now();
    db.prepare(
      "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES ('th1', ?, '[]', 0)",
    ).run(c.id);
    db.prepare(
      "INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "m1",
      "th1",
      "agent",
      a.id,
      "thinking",
      JSON.stringify([{ name: "Bash", input: { command: "ls" } }]),
      startTime + 10,
    );
    issuesRepo.update(i.id, { status: "done" }, { actorKind: "user", actorId: null });

    const hist = getToolHistory(db, i.id);
    expect(hist).toHaveLength(1);
    expect(hist[0]!.toolName).toBe("Bash");
  });
});
