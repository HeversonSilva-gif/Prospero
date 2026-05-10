import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { createIssueCommentsRepository } from "../src/issues/comments-repository.js";

describe("issue comments repository", () => {
  it("add + listByIssue ordered by createdAt", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.pragma("foreign_keys = OFF"); // tests use synthetic IDs (matches Task 14 pattern)
    const c = createCompaniesRepository(db).create({ name: "Acme" });
    const i = createIssuesRepository(db).create({
      companyId: c.id,
      projectId: null,
      title: "T",
      description: null,
      assigneeId: null,
      priority: "low",
      parentId: null,
      createdBy: null,
    });
    const comments = createIssueCommentsRepository(db);
    comments.add({ issueId: i.id, senderKind: "user", senderId: null, content: "first" });
    comments.add({ issueId: i.id, senderKind: "agent", senderId: "ag1", content: "second" });
    const list = comments.listByIssue(i.id);
    expect(list).toHaveLength(2);
    expect(list[0]!.content).toBe("first");
    expect(list[1]!.senderKind).toBe("agent");
  });
});
