import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { createCompaniesRepository } from "../../src/companies/repository.js";
import { createAgentsRepository } from "../../src/agents/repository.js";
import { createIssuesRepository } from "../../src/issues/repository.js";
import { computeUnlockedDependents } from "../../src/issues/topo-activation.js";

describe("integration: topo unlock cascade", () => {
  it("done(A) unlocks B (deps [A]); done(B) unlocks C (deps [A,B])", () => {
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
    const mk = (title: string) =>
      repo.create({
        companyId: co.id,
        projectId: null,
        title,
        description: null,
        assigneeId: agent.id,
        priority: "medium",
        parentId: null,
        createdBy: null,
      });
    const a = mk("A");
    const b = mk("B");
    const c = mk("C");
    db.prepare("UPDATE issues SET depends_on_json = ? WHERE id = ?").run(
      JSON.stringify([a.id]),
      b.id,
    );
    db.prepare("UPDATE issues SET depends_on_json = ? WHERE id = ?").run(
      JSON.stringify([a.id, b.id]),
      c.id,
    );

    // Mark A done → only B unlocks (C still has B pending)
    repo.update(a.id, { status: "done" }, { actorKind: "user", actorId: null });
    const wave1 = computeUnlockedDependents(db, a.id, co.id);
    expect(wave1.map((i) => i.id)).toEqual([b.id]);

    // Mark B done → C unlocks
    repo.update(b.id, { status: "done" }, { actorKind: "user", actorId: null });
    const wave2 = computeUnlockedDependents(db, b.id, co.id);
    expect(wave2.map((i) => i.id)).toEqual([c.id]);
  });
});
