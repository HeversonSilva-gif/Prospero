import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../db/migrations.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { buildMemoryBlock, agentMemoryNearFull } from "./system-prompt-memory.js";

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

const deps = (s: ReturnType<typeof setup>, role = "engineer") => ({
  memoriesRepo: s.memoriesRepo,
  skillsRepo: s.skillsRepo,
  userDataDir: s.userDataDir,
  companyId: "c1",
  agentId: "a1",
  role,
});

describe("buildMemoryBlock", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it("always includes the operating manual, even with no memory or skills", () => {
    const block = buildMemoryBlock(deps(s)) ?? "";
    expect(block).toContain("## Your skills");
    expect(block).toContain("operating-manual");
  });

  it("always includes the algorithm L0 entry, even with no memory or skills", () => {
    const block = buildMemoryBlock(deps(s)) ?? "";
    expect(block).toContain("## Your skills");
    expect(block).toContain("algorithm");
  });

  it("lists both bundled L0 skills (operating-manual and algorithm) before any user skill", () => {
    const block = buildMemoryBlock(deps(s)) ?? "";
    const opIdx = block.indexOf("operating-manual");
    const algoIdx = block.indexOf("algorithm");
    expect(opIdx).toBeGreaterThan(-1);
    expect(algoIdx).toBeGreaterThan(opIdx); // algorithm appears after operating-manual
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

  it("increments view_count for skills rendered into L0", () => {
    s.skillsRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "common",
      bodyPath: "p",
      description: "COMMON-DESC",
      source: "user_authored",
    });
    const skill = s.skillsRepo.getByName("c1", "a1", "common")!;
    buildMemoryBlock(deps(s));
    expect(s.skillsRepo.getById(skill.id)!.viewCount).toBe(1);
  });

  it("does NOT increment view_count for a skill below MIN_L0_TRUST", () => {
    s.skillsRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "distrusted",
      bodyPath: "p",
      description: "DISTRUSTED-DESC",
      source: "user_authored",
      trust: 0.1,
    });
    const skill = s.skillsRepo.getByName("c1", "a1", "distrusted")!;
    buildMemoryBlock(deps(s));
    expect(s.skillsRepo.getById(skill.id)!.viewCount).toBe(0);
  });

  // Audit 2026-06-03 Inteligência & Contexto I5: memories injected into L0 every
  // turn must record access, or they decay as if unused and get pruned.
  it("records access for an agent memory rendered into L0", () => {
    const mem = s.memoriesRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "lint first",
    });
    expect(s.memoriesRepo.getById(mem.id)!.accessCount).toBe(0);
    buildMemoryBlock(deps(s));
    const after = s.memoriesRepo.getById(mem.id)!;
    expect(after.accessCount).toBe(1);
    expect(after.lastAccessed).not.toBeNull();
  });

  it("records access for a company memory rendered into L0", () => {
    const mem = s.memoriesRepo.create({
      companyId: "c1",
      agentId: null,
      kind: "rule",
      body: "company policy x",
    });
    buildMemoryBlock(deps(s));
    expect(s.memoriesRepo.getById(mem.id)!.accessCount).toBe(1);
  });

  it("does NOT record access for a memory below MIN_L0_TRUST (not rendered)", () => {
    const mem = s.memoriesRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "distrusted memory body",
      trust: 0.1,
    });
    buildMemoryBlock(deps(s));
    expect(s.memoriesRepo.getById(mem.id)!.accessCount).toBe(0);
  });
});

describe("buildMemoryBlock — role inheritance", () => {
  it("includes a skill scoped to the agent's role", () => {
    const s = setup();
    s.skillsRepo.create({
      companyId: "c1",
      agentId: null,
      name: "eng-runbook",
      bodyPath: "p",
      description: "ENG-ROLE-SKILL",
      source: "user_authored",
      appliesToRole: "engineer",
    });
    const block = buildMemoryBlock(deps(s, "engineer")) ?? "";
    expect(block).toContain("ENG-ROLE-SKILL");
  });

  it("excludes a skill scoped to a different role", () => {
    const s = setup();
    s.skillsRepo.create({
      companyId: "c1",
      agentId: null,
      name: "design-runbook",
      bodyPath: "p",
      description: "DESIGN-ROLE-SKILL",
      source: "user_authored",
      appliesToRole: "designer",
    });
    const block = buildMemoryBlock(deps(s, "engineer")) ?? "";
    expect(block).not.toContain("DESIGN-ROLE-SKILL");
  });

  it("includes a company-global (role-unscoped) skill for any role", () => {
    const s = setup();
    s.skillsRepo.create({
      companyId: "c1",
      agentId: null,
      name: "global-runbook",
      bodyPath: "p",
      description: "GLOBAL-SKILL",
      source: "user_authored",
    });
    expect(buildMemoryBlock(deps(s, "designer")) ?? "").toContain("GLOBAL-SKILL");
  });

  it("includes a memory scoped to the agent's role", () => {
    const s = setup();
    s.memoriesRepo.create({
      companyId: "c1",
      agentId: null,
      kind: "rule",
      body: "ENG-ROLE-MEMORY",
      appliesToRole: "engineer",
    });
    expect(buildMemoryBlock(deps(s, "engineer")) ?? "").toContain("ENG-ROLE-MEMORY");
  });
});

describe("buildMemoryBlock — L0 trust filter", () => {
  it("excludes skills and memories with trust below 0.2 from the L0 block", () => {
    const s = setup();

    // Trusted skill (trust 0.5, default) — must appear.
    s.skillsRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "trusted-skill",
      bodyPath: "p",
      description: "trusted skill desc",
      source: "user_authored",
    });

    // Distrusted skill (trust 0.1) — must NOT appear.
    s.skillsRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "distrusted-skill",
      bodyPath: "p",
      description: "distrusted skill desc",
      source: "user_authored",
      trust: 0.1,
    });

    // Trusted memory (trust 0.5, default) — must appear.
    s.memoriesRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "trusted memory body",
    });

    // Distrusted memory (trust 0.1) — must NOT appear.
    s.memoriesRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "distrusted memory body",
      trust: 0.1,
    });

    const block = buildMemoryBlock(deps(s)) ?? "";
    expect(block).toContain("trusted-skill");
    expect(block).not.toContain("distrusted-skill");
    expect(block).toContain("trusted memory body");
    expect(block).not.toContain("distrusted memory body");
  });
});

describe("agentMemoryNearFull", () => {
  it("is false for an agent with little memory", () => {
    const s = setup();
    s.memoriesRepo.create({ companyId: "c1", agentId: "a1", kind: "rule", body: "short entry" });
    expect(agentMemoryNearFull(s.memoriesRepo, "a1")).toBe(false);
  });

  it("is true once the agent's memory fills past 90% of the cap", () => {
    const s = setup();
    // AGENT_CAP = 1024; each rendered line is "- <body>\n" = 2 + body.length + 1 chars.
    // With body = 80 chars, each line = 83 chars. 13 lines = 1079 chars > 921.6 (0.9 * 1024).
    for (let i = 0; i < 20; i++) {
      s.memoriesRepo.create({
        companyId: "c1",
        agentId: "a1",
        kind: "rule",
        body: `mem${String(i).padStart(3, "0")}${"x".repeat(76)}`,
      });
    }
    expect(agentMemoryNearFull(s.memoriesRepo, "a1")).toBe(true);
  });
});
