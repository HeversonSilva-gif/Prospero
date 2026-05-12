import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createProjectsRepository } from "../src/projects/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";

const setup = (): {
  db: Database.Database;
  companyId: string;
  projectId: string;
} => {
  const db = new Database(":memory:");
  applyMigrations(db);
  const companyId = "co_test";
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    companyId,
    "Test Co",
    Date.now(),
  );
  const projects = createProjectsRepository(db);
  const project = projects.create({
    companyId,
    name: "Backend",
    path: "C:/p",
    color: "#000",
  });
  projects.setSlug(project.id, "BACKEND");
  return { db, companyId, projectId: project.id };
};

const newInput = (
  companyId: string,
  projectId: string,
  title: string,
): Parameters<ReturnType<typeof createIssuesRepository>["create"]>[0] => ({
  companyId,
  projectId,
  title,
  description: null,
  assigneeId: null,
  priority: "medium",
  parentId: null,
  createdBy: null,
});

describe("IssuesRepository — identifier", () => {
  it("assigns issue_number=1 and identifier='BACKEND-1' on first create", () => {
    const { db, companyId, projectId } = setup();
    const repo = createIssuesRepository(db);
    const issue = repo.create(newInput(companyId, projectId, "First"));
    expect(issue.issueNumber).toBe(1);
    expect(issue.identifier).toBe("BACKEND-1");
  });

  it("monotonically increments issue_number per project", () => {
    const { db, companyId, projectId } = setup();
    const repo = createIssuesRepository(db);
    const a = repo.create(newInput(companyId, projectId, "A"));
    const b = repo.create(newInput(companyId, projectId, "B"));
    const c = repo.create(newInput(companyId, projectId, "C"));
    expect([a.issueNumber, b.issueNumber, c.issueNumber]).toEqual([1, 2, 3]);
    expect([a.identifier, b.identifier, c.identifier]).toEqual([
      "BACKEND-1",
      "BACKEND-2",
      "BACKEND-3",
    ]);
  });

  it("independent counters per project", () => {
    const { db, companyId, projectId } = setup();
    const projects = createProjectsRepository(db);
    const other = projects.create({
      companyId,
      name: "Frontend",
      path: "C:/q",
      color: "#000",
    });
    projects.setSlug(other.id, "FRONT");
    const repo = createIssuesRepository(db);
    const a = repo.create(newInput(companyId, projectId, "A"));
    const b = repo.create(newInput(companyId, other.id, "B"));
    expect(a.identifier).toBe("BACKEND-1");
    expect(b.identifier).toBe("FRONT-1");
  });

  it("does not assign identifier when project has no slug", () => {
    const { db, companyId } = setup();
    const projects = createProjectsRepository(db);
    const noSlug = projects.create({
      companyId,
      name: "Misc",
      path: "C:/r",
      color: "#000",
    });
    const repo = createIssuesRepository(db);
    const issue = repo.create(newInput(companyId, noSlug.id, "X"));
    expect(issue.issueNumber).toBe(1);
    expect(issue.identifier).toBeNull();
  });

  it("getByIdentifier() looks up issue by identifier string", () => {
    const { db, companyId, projectId } = setup();
    const repo = createIssuesRepository(db);
    const a = repo.create(newInput(companyId, projectId, "A"));
    repo.create(newInput(companyId, projectId, "B"));
    const found = repo.getByIdentifier("BACKEND-1");
    expect(found?.id).toBe(a.id);
  });

  it("getByIdentifier() returns null for unknown identifier", () => {
    const { db } = setup();
    const repo = createIssuesRepository(db);
    expect(repo.getByIdentifier("NOPE-99")).toBeNull();
  });
});
