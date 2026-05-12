import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createMessagesRepository } from "../src/messages/repository.js";

const seed = (db: Database.Database): string => {
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "co_1",
    "Co",
    Date.now(),
  );
  return "co_1";
};

describe("MessagesRepository — kind", () => {
  it("defaults to kind='message' when not provided", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companyId = seed(db);
    const repo = createMessagesRepository(db);
    const msg = repo.append({
      companyId,
      participants: ["user", "ag_1"],
      senderKind: "user",
      senderId: null,
      content: "hi",
    });
    expect(msg.kind).toBe("message");
  });

  it("persists kind='question' when provided", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companyId = seed(db);
    const repo = createMessagesRepository(db);
    const msg = repo.append({
      companyId,
      participants: ["user", "ag_1"],
      senderKind: "agent",
      senderId: "ag_1",
      content: "what next?",
      kind: "question",
    });
    expect(msg.kind).toBe("question");
    const fetched = repo.list(msg.threadId);
    expect(fetched[0]!.kind).toBe("question");
  });
});
