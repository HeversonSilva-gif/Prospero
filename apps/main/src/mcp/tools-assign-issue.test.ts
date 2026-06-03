import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { toolDefinitions, type ToolContext } from "./tools.js";
import { createIssuesRepository } from "../issues/repository.js";

const assignTool = toolDefinitions.find((t) => t.name === "assign_issue")!;
const listAgentsTool = toolDefinitions.find((t) => t.name === "list_agents")!;
const updateTool = toolDefinitions.find((t) => t.name === "update_issue")!;

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id,name,created_at) VALUES ('c1','Acme',?)").run(Date.now());
  const seedAgent = (id: string, terminatedAt: number | null): void => {
    db.prepare(
      `INSERT INTO agents (id,company_id,name,role,system_prompt,capabilities_json,allowed_projects_json,mode,always_on,status,model,adapter_name,terminated_at,created_at,updated_at)
       VALUES (?,?,?,'engineer','','[]','[]','supervised',0,'idle','claude-sonnet-4-6','claude-oauth-local',?,?,?)`,
    ).run(id, "c1", id, terminatedAt, Date.now(), Date.now());
  };
  seedAgent("live1", null);
  seedAgent("dead1", Date.now()); // terminated — must be unassignable + hidden
  const ctx: ToolContext = {
    agentId: "live1",
    companyId: "c1",
    db,
    permissionsDir: "/tmp/perm",
    userDataDir: "/tmp/perm",
    emit: () => {},
  };
  return { db, ctx };
}

const makeIssue = (db: Database.Database) =>
  createIssuesRepository(db).create({
    companyId: "c1",
    title: "T",
    projectId: null,
    description: null,
    assigneeId: null,
    priority: "medium",
    parentId: null,
    createdBy: null,
  });

describe("assign_issue / list_agents — terminated agents", () => {
  it("refuses to assign an issue to a terminated agent (and leaves it unassigned)", async () => {
    const { db, ctx } = setup();
    const issue = makeIssue(db);
    const out = JSON.parse(
      await assignTool.run({ issue_id: issue.id, agent_id: "dead1" }, ctx),
    ) as { ok?: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not found/i);
    expect(createIssuesRepository(db).getById(issue.id)?.assigneeId).toBeNull();
  });

  it("assigns to a live agent", async () => {
    const { db, ctx } = setup();
    const issue = makeIssue(db);
    const out = JSON.parse(
      await assignTool.run({ issue_id: issue.id, agent_id: "live1" }, ctx),
    ) as { assignee?: string };
    expect(out.assignee).toBe("live1");
  });

  it("emits issue.assigned so MAIN wakes the new assignee (agent delegation wasn't waking anyone)", async () => {
    const { db } = setup();
    const issue = makeIssue(db);
    const events: { kind: string; payload: unknown }[] = [];
    const ctx2: ToolContext = {
      agentId: "live1",
      companyId: "c1",
      db,
      permissionsDir: "/tmp/perm",
      userDataDir: "/tmp/perm",
      emit: (e) => events.push(e),
    };
    await assignTool.run({ issue_id: issue.id, agent_id: "live1" }, ctx2);
    expect(events.map((e) => e.kind)).toContain("issue.assigned");
  });

  it("update_issue emits the status change so MAIN can record the activity (C5: agent work was invisible to learning)", async () => {
    const { db } = setup();
    const issue = makeIssue(db); // created as 'todo'
    const events: { kind: string; payload: unknown }[] = [];
    const ctx2: ToolContext = {
      agentId: "live1",
      companyId: "c1",
      db,
      permissionsDir: "/tmp/perm",
      userDataDir: "/tmp/perm",
      emit: (e) => events.push(e),
    };
    await updateTool.run({ id: issue.id, status: "done" }, ctx2);
    const updated = events.find((e) => e.kind === "issue.updated");
    const sc = (
      updated?.payload as { statusChange?: { from: string; to: string; agentId: string } }
    ).statusChange;
    expect(sc).toEqual({ from: "todo", to: "done", agentId: "live1" });
  });

  it("list_agents excludes terminated agents", async () => {
    const { ctx } = setup();
    const out = JSON.parse(await listAgentsTool.run({}, ctx)) as { agents: { id: string }[] };
    const ids = out.agents.map((a) => a.id);
    expect(ids).toContain("live1");
    expect(ids).not.toContain("dead1");
  });
});
