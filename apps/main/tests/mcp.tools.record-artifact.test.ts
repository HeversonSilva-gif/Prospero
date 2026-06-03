import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { toolDefinitions, type ToolContext } from "../src/mcp/tools.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { createProjectsRepository } from "../src/projects/repository.js";

const tool = (name: string) => {
  const t = toolDefinitions.find((x) => x.name === name);
  if (t === undefined) throw new Error(`tool not found: ${name}`);
  return { run: t.run as (i: unknown, c: unknown) => Promise<string> };
};

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "co_1",
    "Co",
    Date.now(),
  );
  db.prepare(
    "INSERT INTO agents (id, company_id, name, role, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("ag_1", "co_1", "Eng", "engineer", "p", Date.now(), Date.now());
  const projects = createProjectsRepository(db);
  const project = projects.create({
    companyId: "co_1",
    name: "Backend",
    path: "C:/p",
    color: "#000",
  });
  projects.setSlug(project.id, "BACKEND");
  const issues = createIssuesRepository(db);
  const issue = issues.create({
    companyId: "co_1",
    projectId: project.id,
    title: "T",
    description: null,
    // Assigned to the caller (ag_1) so record_artifact's assignee authz (C8)
    // passes for the happy-path tests.
    assigneeId: "ag_1",
    priority: "medium",
    parentId: null,
    createdBy: "ag_1",
  });
  const ctx: ToolContext = {
    agentId: "ag_1",
    companyId: "co_1",
    db,
    permissionsDir: "C:/tmp",
    userDataDir: "/tmp/userdata",
    emit: () => {},
  };
  return { db, ctx, issueId: issue.id, identifier: issue.identifier };
};

describe("MCP record_artifact", () => {
  it("creates an artifact row for valid input (uuid)", async () => {
    const { ctx, issueId } = setup();
    const result = JSON.parse(
      await tool("record_artifact").run(
        {
          issue_id: issueId,
          kind: "commit_sha",
          ref: "0123456789abcdef0123456789abcdef01234567",
        },
        ctx,
      ),
    ) as { id: string };
    expect(result.id.startsWith("art_")).toBe(true);
  });

  it("creates an artifact row when issue_id is identifier", async () => {
    const { ctx, identifier } = setup();
    if (identifier === null) throw new Error("identifier must be set");
    const result = JSON.parse(
      await tool("record_artifact").run(
        { issue_id: identifier, kind: "pr_url", ref: "https://example.com/pr/1" },
        ctx,
      ),
    ) as { id: string };
    expect(result.id.startsWith("art_")).toBe(true);
  });

  it("rejects invalid commit_sha (too short / non-hex)", async () => {
    const { ctx, issueId } = setup();
    const result = JSON.parse(
      await tool("record_artifact").run({ issue_id: issueId, kind: "commit_sha", ref: "abc" }, ctx),
    ) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/commit_sha/i);
  });

  it("accepts a short SHA and a 64-char SHA-256 commit ref (not just 40-hex)", async () => {
    const { ctx, issueId } = setup();
    for (const ref of ["abc1234", "a".repeat(64)]) {
      const result = JSON.parse(
        await tool("record_artifact").run({ issue_id: issueId, kind: "commit_sha", ref }, ctx),
      ) as { id?: string };
      expect(result.id?.startsWith("art_")).toBe(true);
    }
  });

  it("rejects preview longer than 4096 chars", async () => {
    const { ctx, issueId } = setup();
    const tooLong = "x".repeat(4097);
    const result = JSON.parse(
      await tool("record_artifact").run(
        { issue_id: issueId, kind: "output_text", ref: "o1", preview: tooLong },
        ctx,
      ),
    ) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it("rejects ref longer than 1024 chars", async () => {
    const { ctx, issueId } = setup();
    const tooLong = "x".repeat(1025);
    const result = JSON.parse(
      await tool("record_artifact").run(
        { issue_id: issueId, kind: "output_text", ref: tooLong },
        ctx,
      ),
    ) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for unknown issue", async () => {
    const { ctx } = setup();
    const result = JSON.parse(
      await tool("record_artifact").run(
        { issue_id: "iss_does_not_exist", kind: "output_text", ref: "x" },
        ctx,
      ),
    ) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it("refuses an artifact from an agent who is not the assignee or CEO (C8 authz)", async () => {
    // Audit 2026-06-03 C8/I-authz: fabricating another agent's delivery is
    // trust laundering. Only the assignee or the CEO may record an artifact.
    const { db, issueId } = setup(); // issue assigned to ag_1
    const intruderCtx: ToolContext = {
      agentId: "intruder",
      companyId: "co_1",
      db,
      permissionsDir: "C:/tmp",
      userDataDir: "/tmp/userdata",
      emit: () => {},
    };
    const result = JSON.parse(
      await tool("record_artifact").run(
        { issue_id: issueId, kind: "output_text", ref: "o1" },
        intruderCtx,
      ),
    ) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/assignee|CEO/i);
  });
});

describe("MCP update_issue soft warning on done without artifact", () => {
  it("includes warning when status='done' is set with zero artifacts", async () => {
    const { ctx, db, issueId } = setup();
    // done is only reachable from doing/review (I-sm guard).
    createIssuesRepository(db).update(
      issueId,
      { status: "doing" },
      {
        actorKind: "agent",
        actorId: "ag_1",
      },
    );
    const result = JSON.parse(
      await tool("update_issue").run({ id: issueId, status: "done" }, ctx),
    ) as { id: string; status: string; warning?: string };
    expect(result.status).toBe("done");
    expect(result.warning ?? "").toMatch(/artifact/i);
  });

  it("omits warning when at least one artifact exists", async () => {
    const { ctx, db, issueId } = setup();
    createIssuesRepository(db).update(
      issueId,
      { status: "doing" },
      {
        actorKind: "agent",
        actorId: "ag_1",
      },
    );
    await tool("record_artifact").run({ issue_id: issueId, kind: "output_text", ref: "o1" }, ctx);
    const result = JSON.parse(
      await tool("update_issue").run({ id: issueId, status: "done" }, ctx),
    ) as { warning?: string };
    expect(result.warning).toBeUndefined();
  });
});
