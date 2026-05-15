import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createCompaniesRepository } from "../companies/repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createIssueCommentsRepository } from "../issues/comments-repository.js";
import { issuesToolDefinitions } from "./tools-issues.js";
import type { ToolContext } from "./tools.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const co = createCompaniesRepository(db).create({ name: "A" });
  const agent = createAgentsRepository(db).create({
    companyId: co.id,
    name: "Eng",
    role: "engineer",
    systemPrompt: "x",
    mode: "supervised",
    alwaysOn: false,
    model: "claude-sonnet-4-6",
    templateId: "role-engineer",
  });
  const issue = createIssuesRepository(db).create({
    companyId: co.id,
    projectId: null,
    title: "T",
    description: null,
    assigneeId: null,
    priority: "medium",
    parentId: null,
    createdBy: null,
  });
  return {
    db,
    co,
    issue,
    ctx: {
      agentId: agent.id,
      companyId: co.id,
      db,
      permissionsDir: "",
      userDataDir: "/tmp/userdata",
      emit: () => undefined,
    } as ToolContext,
  };
};

const findTool = (name: string) => {
  const t = issuesToolDefinitions.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
};

describe("comment_on_issue MCP tool", () => {
  it("happy path: inserts comment with sanitized content", async () => {
    const env = setup();
    const tool = findTool("comment_on_issue");
    const result = JSON.parse(
      await tool.run({ issueId: env.issue.id, comment: "Hello" }, env.ctx),
    ) as {
      commentId: string;
      createdAt: number;
    };
    expect(result.commentId).toBeTruthy();
    expect(result.createdAt).toBeGreaterThan(0);
    const comments = createIssueCommentsRepository(env.db).listByIssue(env.issue.id);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.content).toBe("Hello");
    expect(comments[0]?.senderKind).toBe("agent");
  });

  it("rejects cross-company issueId", async () => {
    const env = setup();
    const co2 = createCompaniesRepository(env.db).create({ name: "B" });
    const otherIssue = createIssuesRepository(env.db).create({
      companyId: co2.id,
      projectId: null,
      title: "Other",
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    const tool = findTool("comment_on_issue");
    await expect(tool.run({ issueId: otherIssue.id, comment: "x" }, env.ctx)).rejects.toThrow(
      /not found/i,
    );
  });

  it("rejects empty comment", async () => {
    const env = setup();
    const tool = findTool("comment_on_issue");
    await expect(tool.run({ issueId: env.issue.id, comment: "" }, env.ctx)).rejects.toThrow();
  });

  it("rejects oversized comment (>5000 chars)", async () => {
    const env = setup();
    const tool = findTool("comment_on_issue");
    const long = "x".repeat(5001);
    await expect(tool.run({ issueId: env.issue.id, comment: long }, env.ctx)).rejects.toThrow();
  });

  it("collapses excessive newline runs in sanitization", async () => {
    const env = setup();
    const tool = findTool("comment_on_issue");
    await tool.run({ issueId: env.issue.id, comment: "Line1\n\n\n\n\nLine2" }, env.ctx);
    const comments = createIssueCommentsRepository(env.db).listByIssue(env.issue.id);
    expect(comments[0]?.content).toBe("Line1\n\nLine2");
  });
});
