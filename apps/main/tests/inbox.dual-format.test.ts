import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createInboxRepository } from "../src/inbox/repository.js";
import { createApprovalsRepository } from "../src/approvals/repository.js";

const seed = (db: Database.Database) => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "co_1",
    "Co",
    Date.now(),
  );
  db.prepare(
    "INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ag_1", "co_1", "A", "engineer", "p", Date.now(), Date.now());
};

describe("Inbox dual-format handler", () => {
  it("markReadByApprovalId marks new-format inbox approval as read", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db);
    const approvals = createApprovalsRepository(db);
    const inbox = createInboxRepository(db);
    const approval = approvals.create({
      agentId: "ag_1",
      kind: "tool_call",
      payload: { tool_name: "Bash", tool_input: {}, tool_use_id: "tu_new" },
    });
    const item = inbox.create({
      companyId: "co_1",
      kind: "approval",
      actorId: "ag_1",
      title: "approval",
      approvalId: approval.id,
      payloadJson: JSON.stringify({ approval_id: approval.id, tool_use_id: "tu_new" }),
      requiresAction: true,
    });
    const marked = inbox.markReadByApprovalId(approval.id);
    expect(marked?.id).toBe(item.id);
    expect(marked?.readAt).not.toBeNull();
  });

  it("markReadByToolUseId still works for legacy inline rows (no approval_id)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    seed(db);
    const inbox = createInboxRepository(db);
    const legacy = inbox.create({
      companyId: "co_1",
      kind: "approval",
      actorId: "ag_1",
      title: "legacy approval",
      payloadJson: JSON.stringify({ toolUseId: "tu_legacy", legacy: true }),
      requiresAction: true,
    });
    const marked = inbox.markReadByToolUseId("tu_legacy");
    expect(marked?.id).toBe(legacy.id);
  });
});
