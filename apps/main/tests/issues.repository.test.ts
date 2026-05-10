import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createProjectsRepository } from "../src/projects/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";

const setup = () => {
  const db = new Database(":memory:");
  // FK enforcement is ON by default in this build; disable for test isolation
  // (production uses openDatabase which re-enables it after migrations)
  db.pragma("foreign_keys = OFF");
  applyMigrations(db);
  const c = createCompaniesRepository(db).create({ name: "Acme" });
  const p = createProjectsRepository(db).create({
    companyId: c.id,
    name: "Web",
    path: "C:/w",
    color: "#1D5DD7",
  });
  const issues = createIssuesRepository(db);
  return { db, issues, companyId: c.id, projectId: p.id };
};

describe("issues repository", () => {
  it("create writes a 'created' event", () => {
    const { issues, companyId, projectId, db } = setup();
    const i = issues.create({
      companyId,
      projectId,
      title: "Setup CI",
      description: "wire actions",
      assigneeId: null,
      priority: "high",
      parentId: null,
      createdBy: null,
    });
    expect(i.title).toBe("Setup CI");
    const events = db.prepare("SELECT kind FROM issue_events WHERE issue_id = ?").all(i.id) as {
      kind: string;
    }[];
    expect(events.map((e) => e.kind)).toEqual(["created"]);
  });

  it("update emits one event per changed field", () => {
    const { issues, companyId, projectId, db } = setup();
    const i = issues.create({
      companyId,
      projectId,
      title: "X",
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    issues.update(
      i.id,
      { status: "doing", priority: "urgent" },
      { actorKind: "user", actorId: null },
    );
    const events = db
      .prepare("SELECT kind FROM issue_events WHERE issue_id = ? ORDER BY created_at ASC")
      .all(i.id) as { kind: string }[];
    expect(events.map((e) => e.kind)).toEqual(["created", "status_changed", "priority_changed"]);
  });

  it("update with same value emits no event", () => {
    const { issues, companyId, projectId, db } = setup();
    const i = issues.create({
      companyId,
      projectId,
      title: "X",
      description: null,
      assigneeId: null,
      priority: "medium",
      parentId: null,
      createdBy: null,
    });
    issues.update(i.id, { status: "todo" }, { actorKind: "user", actorId: null });
    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM issue_events WHERE issue_id = ?").get(i.id) as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it("list filters by projectId, status, assigneeId", () => {
    const { issues, companyId, projectId } = setup();
    issues.create({
      companyId,
      projectId,
      title: "A",
      description: null,
      assigneeId: "ag1",
      priority: "low",
      parentId: null,
      createdBy: null,
    });
    const b = issues.create({
      companyId,
      projectId,
      title: "B",
      description: null,
      assigneeId: "ag2",
      priority: "low",
      parentId: null,
      createdBy: null,
    });
    issues.update(b.id, { status: "doing" }, { actorKind: "system", actorId: null });
    expect(issues.list({ companyId, status: "doing" })).toHaveLength(1);
    expect(issues.list({ companyId, assigneeId: "ag1" })).toHaveLength(1);
  });

  it("delete cascades comments + events + subtasks", () => {
    const { issues, companyId, projectId, db } = setup();
    const parent = issues.create({
      companyId,
      projectId,
      title: "Parent",
      description: null,
      assigneeId: null,
      priority: "low",
      parentId: null,
      createdBy: null,
    });
    issues.create({
      companyId,
      projectId,
      title: "Sub",
      description: null,
      assigneeId: null,
      priority: "low",
      parentId: parent.id,
      createdBy: null,
    });
    db.prepare(
      "INSERT INTO issue_comments (id, issue_id, sender_kind, content, created_at) VALUES ('co1', ?, 'user', 'hi', 0)",
    ).run(parent.id);
    issues.delete(parent.id);
    const issuesLeft = (db.prepare("SELECT COUNT(*) AS n FROM issues").get() as { n: number }).n;
    expect(issuesLeft).toBe(0);
    const commentsLeft = (
      db.prepare("SELECT COUNT(*) AS n FROM issue_comments").get() as { n: number }
    ).n;
    expect(commentsLeft).toBe(0);
  });

  it("getDetail resolves project + assignee + subtasks + comments", () => {
    const { issues, companyId, projectId, db } = setup();
    const i = issues.create({
      companyId,
      projectId,
      title: "X",
      description: null,
      assigneeId: null,
      priority: "low",
      parentId: null,
      createdBy: null,
    });
    issues.create({
      companyId,
      projectId,
      title: "Sub",
      description: null,
      assigneeId: null,
      priority: "low",
      parentId: i.id,
      createdBy: null,
    });
    db.prepare(
      "INSERT INTO issue_comments (id, issue_id, sender_kind, content, created_at) VALUES ('co1', ?, 'user', 'hi', 0)",
    ).run(i.id);
    const detail = issues.getDetail(i.id);
    expect(detail).not.toBeNull();
    expect(detail!.subtasks).toHaveLength(1);
    expect(detail!.comments).toHaveLength(1);
    expect(detail!.events.length).toBeGreaterThanOrEqual(1);
    expect(detail!.project?.name).toBe("Web");
  });

  it("resolveProjectByNameOrId returns id when name matches uniquely", () => {
    const { issues, companyId, projectId } = setup();
    expect(issues.resolveProjectByNameOrId(companyId, "Web")).toEqual({
      id: projectId,
      matches: 1,
    });
    expect(issues.resolveProjectByNameOrId(companyId, projectId)).toEqual({
      id: projectId,
      matches: 1,
    });
    expect(issues.resolveProjectByNameOrId(companyId, "Ghost")).toEqual({ id: "", matches: 0 });
  });
});
