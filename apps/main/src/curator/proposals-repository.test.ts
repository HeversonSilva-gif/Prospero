import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createProposalsRepository } from "./proposals-repository.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
});

const mk = () =>
  createProposalsRepository(db).create({
    companyId: "c1",
    kind: "merge",
    sourceSkillIds: ["s1", "s2"],
    proposedName: "merged",
    proposedDescription: "d",
    proposedBody: "body",
    rationale: "overlap",
  });

describe("proposals-repository", () => {
  it("creates and reads back, parsing sourceSkillIds", () => {
    const p = mk();
    const got = createProposalsRepository(db).getById(p.id)!;
    expect(got.sourceSkillIds).toEqual(["s1", "s2"]);
    expect(got.status).toBe("pending");
  });
  it("listPending returns only pending for the company", () => {
    mk();
    expect(createProposalsRepository(db).listPending("c1")).toHaveLength(1);
  });
  it("updateStatus marks accepted", () => {
    const p = mk();
    const repo = createProposalsRepository(db);
    repo.updateStatus(p.id, "accepted", "user");
    expect(repo.getById(p.id)!.status).toBe("accepted");
    expect(repo.listPending("c1")).toHaveLength(0);
  });
});
