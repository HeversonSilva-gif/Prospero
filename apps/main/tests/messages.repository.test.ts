import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createMessagesRepository } from "../src/messages/repository.js";
import { createDemoCompany } from "../src/companies/seed.js";
import { createAgentsRepository } from "../src/agents/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const company = createDemoCompany(db);
  const agents = createAgentsRepository(db).listByCompany(company.id);
  const ceo = agents[0]!;
  const repo = createMessagesRepository(db);
  return { repo, companyId: company.id, ceoId: ceo.id };
};

describe("messages repository", () => {
  it("appends a user message and lists it", () => {
    const { repo, companyId, ceoId } = setup();
    const m = repo.append({
      companyId,
      participants: ["user", ceoId],
      senderKind: "user",
      senderId: null,
      content: "hi",
    });
    const all = repo.listByParticipants(companyId, ["user", ceoId]);
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(m.id);
  });

  it("threads are keyed canonically (user, agent) === (agent, user)", () => {
    const { repo, companyId, ceoId } = setup();
    repo.append({
      companyId,
      participants: ["user", ceoId],
      senderKind: "user",
      senderId: null,
      content: "1",
    });
    const all = repo.listByParticipants(companyId, [ceoId, "user"]);
    expect(all).toHaveLength(1);
  });

  it("appendToThreadId writes to existing thread without participants", () => {
    const { repo, companyId, ceoId } = setup();
    // Create a thread first via append
    const first = repo.append({
      companyId,
      participants: ["user", ceoId],
      senderKind: "user",
      senderId: null,
      content: "first",
    });
    const m = repo.appendToThreadId({
      threadId: first.threadId,
      senderKind: "agent",
      senderId: ceoId,
      content: "hi",
    });
    expect(m.threadId).toBe(first.threadId);
    expect(repo.list(first.threadId)).toHaveLength(2);
  });

  it("preserves tool calls JSON round-trip", () => {
    const { repo, companyId, ceoId } = setup();
    repo.append({
      companyId,
      participants: ["user", ceoId],
      senderKind: "agent",
      senderId: ceoId,
      content: "running...",
      toolCalls: [
        { id: "tc1", name: "create_issue", input: { title: "x" }, status: "success", result: "ok" },
      ],
    });
    const all = repo.listByParticipants(companyId, ["user", ceoId]);
    expect(all[0]?.toolCalls?.[0]?.name).toBe("create_issue");
  });
});
