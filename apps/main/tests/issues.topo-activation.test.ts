import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../src/db/migrations.js";
import { createCompaniesRepository } from "../src/companies/repository.js";
import { createAgentsRepository } from "../src/agents/repository.js";
import { createIssuesRepository } from "../src/issues/repository.js";
import { computeUnlockedDependents } from "../src/issues/topo-activation.js";

const setup = () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  applyMigrations(db);
  const co = createCompaniesRepository(db).create({ name: "A" });
  const agent = createAgentsRepository(db).create({
    companyId: co.id,
    name: "E",
    role: "eng",
    systemPrompt: "x",
    mode: "supervised",
    alwaysOn: false,
    model: "claude-sonnet-4-6",
    templateId: "role-engineer",
  });
  const repo = createIssuesRepository(db);
  return { db, co, agent, repo };
};

const setDeps = (db: Database.Database, issueId: string, deps: string[]) => {
  db.prepare("UPDATE issues SET depends_on_json = ? WHERE id = ?").run(
    JSON.stringify(deps),
    issueId,
  );
};

const mkIssue = (env: ReturnType<typeof setup>, title: string) =>
  env.repo.create({
    companyId: env.co.id,
    projectId: null,
    title,
    description: null,
    assigneeId: env.agent.id,
    priority: "medium",
    parentId: null,
    createdBy: null,
  });

describe("computeUnlockedDependents", () => {
  it("returns dependents whose all deps are done", () => {
    const env = setup();
    const a = mkIssue(env, "A");
    const b = mkIssue(env, "B");
    setDeps(env.db, b.id, [a.id]);
    env.repo.update(a.id, { status: "done" }, { actorKind: "user", actorId: null });
    const unlocked = computeUnlockedDependents(env.db, a.id, env.co.id);
    expect(unlocked.map((i) => i.id)).toEqual([b.id]);
  });

  it("does not return dependents with at least one dep still pending", () => {
    const env = setup();
    const a = mkIssue(env, "A");
    const b = mkIssue(env, "B");
    const c = mkIssue(env, "C");
    setDeps(env.db, c.id, [a.id, b.id]);
    env.repo.update(a.id, { status: "done" }, { actorKind: "user", actorId: null });
    const unlocked = computeUnlockedDependents(env.db, a.id, env.co.id);
    expect(unlocked).toEqual([]);
  });

  it("does not return dependents already in non-todo state", () => {
    const env = setup();
    const a = mkIssue(env, "A");
    const b = mkIssue(env, "B");
    setDeps(env.db, b.id, [a.id]);
    env.repo.update(b.id, { status: "doing" }, { actorKind: "user", actorId: null });
    env.repo.update(a.id, { status: "done" }, { actorKind: "user", actorId: null });
    expect(computeUnlockedDependents(env.db, a.id, env.co.id)).toEqual([]);
  });

  it("filters LIKE false-positives via JSON parse", () => {
    const env = setup();
    const a = mkIssue(env, "A");
    const fakeId = a.id + "ZZ";
    const b = mkIssue(env, "B");
    setDeps(env.db, b.id, [fakeId]);
    env.repo.update(a.id, { status: "done" }, { actorKind: "user", actorId: null });
    expect(computeUnlockedDependents(env.db, a.id, env.co.id)).toEqual([]);
  });
});
