import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createProposalsRepository } from "./proposals-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { acceptProposal, rejectProposal } from "./apply-proposal.js";

let db: Database.Database;
let dir: string;
beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
  dir = mkdtempSync(join(tmpdir(), "curator-"));
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Co',0)").run();
  db.prepare(
    `INSERT INTO agents
       (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json,
        mode, always_on, status, model, adapter_name, created_at, updated_at)
     VALUES ('a1', 'c1', 'A', 'dev', '', '[]', '[]',
             'supervised', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', 0, 0)`,
  ).run();
});

const skill = (name: string) =>
  createSkillsRepository(db).create({
    companyId: "c1",
    agentId: "a1",
    name,
    bodyPath: join(dir, `${name}.md`),
    description: "d",
    source: "user_authored",
  });

describe("acceptProposal — merge", () => {
  it("writes merged file, creates curated_merge skill, soft-deletes sources, resolves inbox", () => {
    const a = skill("a");
    const b = skill("b");
    const prop = createProposalsRepository(db).create({
      companyId: "c1",
      kind: "merge",
      sourceSkillIds: [a.id, b.id],
      proposedName: "ab",
      proposedDescription: "merged",
      proposedBody: "MERGED",
      rationale: "overlap",
    });
    createInboxRepository(db).create({
      companyId: "c1",
      kind: "skill_consolidation_proposed",
      title: "t",
      requiresAction: true,
      payloadJson: JSON.stringify({ proposalId: prop.id }),
    });

    const merged = acceptProposal(db, dir, { proposalId: prop.id, reviewedBy: "user" });

    expect(merged.source).toBe("curated_merge");
    expect(existsSync(merged.bodyPath)).toBe(true);
    expect(readFileSync(merged.bodyPath, "utf8")).toBe("MERGED");
    const repo = createSkillsRepository(db);
    expect(repo.getById(a.id)!.softDeleted).toBe(true);
    expect(repo.getById(b.id)!.softDeleted).toBe(true);
    expect(createProposalsRepository(db).getById(prop.id)!.status).toBe("accepted");
    const unread = db.prepare("SELECT COUNT(*) n FROM inbox_items WHERE read_at IS NULL").get() as {
      n: number;
    };
    expect(unread.n).toBe(0);
  });
});

describe("acceptProposal — patch", () => {
  it("rewrites the target body and bumps version + patch_count", () => {
    const a = skill("a");
    const prop = createProposalsRepository(db).create({
      companyId: "c1",
      kind: "patch",
      sourceSkillIds: [a.id],
      proposedName: "a",
      proposedDescription: "d2",
      proposedBody: "NEWBODY",
      rationale: "stale",
    });
    acceptProposal(db, dir, { proposalId: prop.id, reviewedBy: "user" });
    const got = createSkillsRepository(db).getById(a.id)!;
    expect(readFileSync(got.bodyPath, "utf8")).toBe("NEWBODY");
    expect(got.version).toBe(2);
    expect(got.patchCount).toBe(1);
  });
});

describe("acceptProposal — archive", () => {
  it("sets the target skill to archived", () => {
    const a = skill("a");
    const prop = createProposalsRepository(db).create({
      companyId: "c1",
      kind: "archive",
      sourceSkillIds: [a.id],
      rationale: "low value",
    });
    acceptProposal(db, dir, { proposalId: prop.id, reviewedBy: "user" });
    expect(createSkillsRepository(db).getById(a.id)!.lifecycleState).toBe("archived");
  });
});

describe("rejectProposal", () => {
  it("marks rejected and resolves the inbox item", () => {
    const a = skill("a");
    const prop = createProposalsRepository(db).create({
      companyId: "c1",
      kind: "archive",
      sourceSkillIds: [a.id],
      rationale: "x",
    });
    createInboxRepository(db).create({
      companyId: "c1",
      kind: "skill_consolidation_proposed",
      title: "t",
      requiresAction: true,
      payloadJson: JSON.stringify({ proposalId: prop.id }),
    });
    rejectProposal(db, { proposalId: prop.id, reviewedBy: "user", reason: "no" });
    expect(createProposalsRepository(db).getById(prop.id)!.status).toBe("rejected");
  });
});
