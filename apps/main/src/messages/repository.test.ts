import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createMessagesRepository } from "./repository.js";

describe("messagesRepository — messages_fts sync", () => {
  const newDb = (): Database.Database => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    return db;
  };

  it("append indexes the new message into messages_fts", () => {
    const db = newDb();
    const repo = createMessagesRepository(db);
    const msg = repo.append({
      companyId: "c1",
      participants: ["user", "agent_1"],
      senderKind: "user",
      senderId: null,
      content: "please profile the postgres query",
    });
    const hits = db
      .prepare("SELECT message_id FROM messages_fts WHERE messages_fts MATCH 'postgres'")
      .all() as Array<{ message_id: string }>;
    expect(hits.map((h) => h.message_id)).toEqual([msg.id]);
  });

  it("appendToThreadId also indexes into messages_fts", () => {
    const db = newDb();
    const repo = createMessagesRepository(db);
    const thread = repo.ensureThread("c1", ["user", "agent_1"]);
    const msg = repo.appendToThreadId({
      threadId: thread.id,
      senderKind: "agent",
      senderId: "agent_1",
      content: "redis cache warmup done",
    });
    const hits = db
      .prepare("SELECT message_id FROM messages_fts WHERE messages_fts MATCH 'redis'")
      .all() as Array<{ message_id: string }>;
    expect(hits.map((h) => h.message_id)).toEqual([msg.id]);
  });
});
