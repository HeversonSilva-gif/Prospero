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

describe("MessagesRepository — countUnansweredQuestions", () => {
  it("counts questions from this agent without a subsequent reply in the same thread", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companyId = seed(db);
    const repo = createMessagesRepository(db);
    repo.append({
      companyId,
      participants: ["user", "ag_1"],
      senderKind: "agent",
      senderId: "ag_1",
      content: "Q1?",
      kind: "question",
    });
    repo.append({
      companyId,
      participants: ["user", "ag_2"],
      senderKind: "agent",
      senderId: "ag_1",
      content: "Q2?",
      kind: "question",
    });
    expect(repo.countUnansweredQuestions("ag_1")).toBe(2);
  });

  it("does not count questions answered by a later message in the same thread", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companyId = seed(db);
    const repo = createMessagesRepository(db);
    repo.append({
      companyId,
      participants: ["user", "ag_1"],
      senderKind: "agent",
      senderId: "ag_1",
      content: "Q?",
      kind: "question",
    });
    repo.append({
      companyId,
      participants: ["user", "ag_1"],
      senderKind: "user",
      senderId: null,
      content: "A.",
    });
    expect(repo.countUnansweredQuestions("ag_1")).toBe(0);
  });

  it("returns 0 when agent has no questions", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const companyId = seed(db);
    const repo = createMessagesRepository(db);
    repo.append({
      companyId,
      participants: ["user", "ag_1"],
      senderKind: "agent",
      senderId: "ag_1",
      content: "hi",
    });
    expect(repo.countUnansweredQuestions("ag_1")).toBe(0);
  });
});
