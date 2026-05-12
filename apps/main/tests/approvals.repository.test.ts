import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createApprovalsRepository } from "../src/approvals/repository.js";

const seed = (db: Database.Database): { companyId: string; agentId: string } => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "co_1",
    "Co",
    Date.now(),
  );
  db.prepare(
    "INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ag_1", "co_1", "A", "engineer", "p", Date.now(), Date.now());
  return { companyId: "co_1", agentId: "ag_1" };
};

describe("ApprovalsRepository", () => {
  it("create() persists with status=pending", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const { agentId } = seed(db);
    const repo = createApprovalsRepository(db);
    const a = repo.create({
      agentId,
      kind: "tool_call",
      payload: { tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "tu_1" },
    });
    expect(a.status).toBe("pending");
    expect(a.kind).toBe("tool_call");
    expect(a.payloadJson).toContain("tool_use_id");
    expect(a.id.startsWith("apv_")).toBe(true);
  });

  it("decide() marks approved + sets resolved_at + decision_note", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const { agentId } = seed(db);
    const repo = createApprovalsRepository(db);
    const a = repo.create({
      agentId,
      kind: "tool_call",
      payload: { tool_name: "Bash", tool_input: {}, tool_use_id: "tu_x" },
    });
    repo.decide(a.id, "approved", "user", "ok");
    const next = repo.getById(a.id);
    expect(next?.status).toBe("approved");
    expect(next?.decidedBy).toBe("user");
    expect(next?.decisionNote).toBe("ok");
    expect(next?.resolvedAt).not.toBeNull();
  });

  it("findPendingByToolUseId() locates pending approval by tool_use_id", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const { agentId } = seed(db);
    const repo = createApprovalsRepository(db);
    const a = repo.create({
      agentId,
      kind: "tool_call",
      payload: { tool_name: "Bash", tool_input: {}, tool_use_id: "tu_y" },
    });
    const found = repo.findPendingByToolUseId("tu_y");
    expect(found?.id).toBe(a.id);
  });

  it("listByAgent() returns approvals scoped to one agent", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const { agentId } = seed(db);
    db.prepare(
      "INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("ag_2", "co_1", "B", "engineer", "p", Date.now(), Date.now());
    const repo = createApprovalsRepository(db);
    repo.create({
      agentId,
      kind: "tool_call",
      payload: { tool_name: "Bash", tool_input: {}, tool_use_id: "tu_a" },
    });
    repo.create({
      agentId: "ag_2",
      kind: "tool_call",
      payload: { tool_name: "Bash", tool_input: {}, tool_use_id: "tu_b" },
    });
    const list = repo.listByAgent(agentId);
    expect(list).toHaveLength(1);
    expect(list[0]!.agentId).toBe(agentId);
  });
});
