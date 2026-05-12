import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { createProjectsRepository } from "../src/projects/repository.js";
import { createArtifactsRepository } from "../src/artifacts/repository.js";

const seed = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
    "co_1",
    "Co",
    Date.now(),
  );
  const projects = createProjectsRepository(db);
  const project = projects.create({
    companyId: "co_1",
    name: "Backend",
    path: "C:/p",
    color: "#000",
  });
  projects.setSlug(project.id, "BACK");
  const issues = createIssuesRepository(db);
  const issue = issues.create({
    companyId: "co_1",
    projectId: project.id,
    title: "T",
    description: null,
    assigneeId: null,
    priority: "medium",
    parentId: null,
    createdBy: null,
  });
  return { db, issueId: issue.id };
};

describe("ArtifactsRepository", () => {
  it("create() persists with id prefix art_", () => {
    const { db, issueId } = seed();
    const repo = createArtifactsRepository(db);
    const a = repo.create({
      issueId,
      kind: "commit_sha",
      ref: "0123456789abcdef0123456789abcdef01234567",
      contentPreview: null,
      createdBy: null,
    });
    expect(a.id.startsWith("art_")).toBe(true);
    expect(a.kind).toBe("commit_sha");
  });

  it("listByIssue() returns artifacts in created_at DESC order, default limit 20", () => {
    const { db, issueId } = seed();
    const repo = createArtifactsRepository(db);
    for (let i = 0; i < 3; i++) {
      repo.create({
        issueId,
        kind: "output_text",
        ref: `r${i}`,
        contentPreview: `p${i}`,
        createdBy: null,
      });
    }
    const list = repo.listByIssue(issueId);
    expect(list).toHaveLength(3);
    // most recent first
    expect(list[0]!.ref).toBe("r2");
  });

  it("countForIssue() returns total even when listByIssue limits", () => {
    const { db, issueId } = seed();
    const repo = createArtifactsRepository(db);
    for (let i = 0; i < 25; i++) {
      repo.create({
        issueId,
        kind: "output_text",
        ref: `r${i}`,
        contentPreview: null,
        createdBy: null,
      });
    }
    expect(repo.countForIssue(issueId)).toBe(25);
    expect(repo.listByIssue(issueId)).toHaveLength(20);
  });
});
