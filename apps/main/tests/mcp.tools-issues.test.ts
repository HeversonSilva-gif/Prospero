import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createProjectsRepository } from "../src/projects/repository.js";
import { toolDefinitions } from "../src/mcp/tools.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.pragma("foreign_keys = OFF"); // matches Task 14 pattern
  const company = createCompaniesRepository(db).create({ name: "Acme" });
  const agent = createAgentsRepository(db).create({
    companyId: company.id,
    name: "Dev1",
    role: "engineer",
    systemPrompt: "x",
    mode: "auto",
    alwaysOn: false,
  });
  const project = createProjectsRepository(db).create({
    companyId: company.id,
    name: "Web",
    path: "C:/w",
    color: "#1D5DD7",
  });
  const ctx = {
    agentId: agent.id,
    companyId: company.id,
    db,
    permissionsDir: "/tmp",
    emit: vi.fn(),
  };
  const tool = (name: string) => toolDefinitions.find((t) => t.name === name)!;
  return { db, ctx, tool, projectId: project.id, agentId: agent.id, companyId: company.id };
};

describe("MCP tools — issues", () => {
  it("create_issue persists with project name lookup", async () => {
    const { ctx, tool } = setup();
    const result = JSON.parse(
      await (tool("create_issue").run as (i: unknown, c: unknown) => Promise<string>)(
        { project: "Web", title: "Setup CI" },
        ctx,
      ),
    ) as { id: string; title: string };
    expect(result.id).toBeDefined();
    expect(result.title).toBe("Setup CI");
    expect(ctx.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: "issue.created" }));
  });

  it("create_issue rejects unknown project", async () => {
    const { ctx, tool } = setup();
    const result = JSON.parse(
      await (tool("create_issue").run as (i: unknown, c: unknown) => Promise<string>)(
        { project: "ghost", title: "X" },
        ctx,
      ),
    ) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it("update_issue with status=done writes Inbox completed", async () => {
    const { ctx, tool, db } = setup();
    const created = JSON.parse(
      await (tool("create_issue").run as (i: unknown, c: unknown) => Promise<string>)(
        { project: "Web", title: "Bug" },
        ctx,
      ),
    ) as { id: string };
    await (tool("update_issue").run as (i: unknown, c: unknown) => Promise<string>)(
      { id: created.id, status: "done" },
      ctx,
    );
    const inboxCount = (
      db.prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE kind = 'completed'").get() as {
        n: number;
      }
    ).n;
    expect(inboxCount).toBe(1);
  });

  it("list_issues filters by status", async () => {
    const { ctx, tool } = setup();
    await (tool("create_issue").run as (i: unknown, c: unknown) => Promise<string>)(
      { project: "Web", title: "A" },
      ctx,
    );
    await (tool("create_issue").run as (i: unknown, c: unknown) => Promise<string>)(
      { project: "Web", title: "B" },
      ctx,
    );
    const all = JSON.parse(
      await (tool("list_issues").run as (i: unknown, c: unknown) => Promise<string>)(
        { project: "Web" },
        ctx,
      ),
    ) as { issues: unknown[] };
    expect(all.issues).toHaveLength(2);
  });

  it("check_status returns id + status", async () => {
    const { ctx, tool } = setup();
    const created = JSON.parse(
      await (tool("create_issue").run as (i: unknown, c: unknown) => Promise<string>)(
        { project: "Web", title: "X" },
        ctx,
      ),
    ) as { id: string };
    const status = JSON.parse(
      await (tool("check_status").run as (i: unknown, c: unknown) => Promise<string>)(
        { issue_id: created.id },
        ctx,
      ),
    ) as { id: string; status: string };
    expect(status.id).toBe(created.id);
    expect(status.status).toBe("todo");
  });
});
