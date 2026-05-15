import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../db/migrations.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { buildMemoryBlock } from "./system-prompt-memory.js";

const setup = () => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  const userDataDir = mkdtempSync(join(tmpdir(), "prospero-spm-"));
  return {
    db,
    userDataDir,
    memoriesRepo: createMemoriesRepository(db),
    skillsRepo: createSkillsRepository(db),
  };
};

const deps = (s: ReturnType<typeof setup>) => ({
  memoriesRepo: s.memoriesRepo,
  skillsRepo: s.skillsRepo,
  userDataDir: s.userDataDir,
  companyId: "c1",
  agentId: "a1",
});

describe("buildMemoryBlock", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it("returns undefined when there is nothing to inject", () => {
    expect(buildMemoryBlock(deps(s))).toBeUndefined();
  });

  it("includes an agent memory entry", () => {
    s.memoriesRepo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "lint first" });
    expect(buildMemoryBlock(deps(s))).toContain("lint first");
  });

  it("includes company-wide memory", () => {
    s.memoriesRepo.create({
      companyId: "c1",
      agentId: null,
      kind: "rule",
      body: "company policy x",
    });
    expect(buildMemoryBlock(deps(s))).toContain("company policy x");
  });

  it("includes skill L0 descriptions", () => {
    s.skillsRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy",
      bodyPath: "p",
      description: "how to deploy the service",
      source: "user_authored",
    });
    expect(buildMemoryBlock(deps(s))).toContain("how to deploy the service");
  });

  it("includes the global user.md file content", () => {
    mkdirSync(join(s.userDataDir, "memory"), { recursive: true });
    writeFileSync(join(s.userDataDir, "memory", "user.md"), "user prefers concise replies", "utf8");
    expect(buildMemoryBlock(deps(s))).toContain("user prefers concise replies");
  });

  it("caps each section by character budget", () => {
    const huge = "x".repeat(20_000);
    s.memoriesRepo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: huge });
    const block = buildMemoryBlock(deps(s)) ?? "";
    expect(block.length).toBeLessThan(8000);
  });

  it("sorts skill L0 by use_count desc", () => {
    s.skillsRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "rare",
      bodyPath: "p",
      description: "RARE-DESC",
      source: "user_authored",
    });
    s.skillsRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "common",
      bodyPath: "p",
      description: "COMMON-DESC",
      source: "user_authored",
    });
    s.skillsRepo.recordUse(s.skillsRepo.getByName("c1", "a1", "common")!.id);
    const block = buildMemoryBlock(deps(s)) ?? "";
    expect(block.indexOf("COMMON-DESC")).toBeLessThan(block.indexOf("RARE-DESC"));
  });
});
