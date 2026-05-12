import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { runPostMigrations } from "../src/db/post-migrations/index.js";
import { toolDefinitions, type ToolContext } from "../src/mcp/tools.js";
import { createProjectsRepository } from "../src/projects/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";

const tool = (name: string) => {
  const t = toolDefinitions.find((x) => x.name === name);
  if (t === undefined) throw new Error(`tool not found: ${name}`);
  return t;
};

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companyId = "co_1";
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    companyId,
    "Co",
    Date.now(),
  );
  const agentId = "ag_user";
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(agentId, companyId, "CEO", "ceo", "prompt", Date.now(), Date.now());
  runPostMigrations(db);
  const ctx: ToolContext = {
    agentId,
    companyId,
    db,
    permissionsDir: "C:/tmp",
    emit: () => {},
  };
  return { db, ctx, companyId, agentId };
};

describe("MCP — list_issues surfaces identifier", () => {
  it("returns identifier alongside id", async () => {
    const { db, ctx } = setup();
    const projects = createProjectsRepository(db);
    const project = projects.create({
      companyId: ctx.companyId,
      name: "Backend",
      path: "C:/p",
      color: "#000",
    });
    projects.setSlug(project.id, "BACKEND");
    const issues = createIssuesRepository(db);
    issues.create({
      companyId: ctx.companyId,
      projectId: project.id,
      title: "A",
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    const result = JSON.parse(await tool("list_issues").run({}, ctx)) as {
      issues: Array<{ id: string; identifier: string | null }>;
    };
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.identifier).toBe("BACKEND-1");
  });
});

describe("MCP — update_issue accepts identifier or UUID", () => {
  it("resolves by identifier when input does not look like a UUID", async () => {
    const { db, ctx } = setup();
    const projects = createProjectsRepository(db);
    const project = projects.create({
      companyId: ctx.companyId,
      name: "Backend",
      path: "C:/p",
      color: "#000",
    });
    projects.setSlug(project.id, "BACKEND");
    const issues = createIssuesRepository(db);
    const created = issues.create({
      companyId: ctx.companyId,
      projectId: project.id,
      title: "A",
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    const result = JSON.parse(
      await tool("update_issue").run({ id: "BACKEND-1", status: "doing" }, ctx),
    ) as { id: string; status: string };
    expect(result.id).toBe(created.id);
    expect(result.status).toBe("doing");
  });

  it("still accepts UUID", async () => {
    const { db, ctx } = setup();
    const projects = createProjectsRepository(db);
    const project = projects.create({
      companyId: ctx.companyId,
      name: "Backend",
      path: "C:/p",
      color: "#000",
    });
    projects.setSlug(project.id, "BACKEND");
    const issues = createIssuesRepository(db);
    const created = issues.create({
      companyId: ctx.companyId,
      projectId: project.id,
      title: "A",
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    const result = JSON.parse(
      await tool("update_issue").run({ id: created.id, status: "doing" }, ctx),
    ) as { id: string };
    expect(result.id).toBe(created.id);
  });
});
