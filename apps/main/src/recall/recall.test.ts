import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { recallForIssue, formatRecallSeed, tokenise } from "./recall.js";

// ---------------------------------------------------------------------------
// DB bootstrap helpers
// ---------------------------------------------------------------------------

const newDb = (): Database.Database => {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
       allowed_projects_json, mode, always_on, status, created_at, updated_at)
     VALUES ('a2','c1','Design','designer','sp','[]','[]','supervised',0,'idle',0,0)`,
  ).run();
  return db;
};

// ---------------------------------------------------------------------------
// tokenise
// ---------------------------------------------------------------------------

describe("tokenise", () => {
  it("lowercases, splits on non-alphanumeric, drops short tokens and stopwords", () => {
    const tokens = tokenise("Deploy the TypeScript module for production");
    expect(tokens).toContain("deploy");
    expect(tokens).toContain("typescript");
    expect(tokens).toContain("module");
    expect(tokens).toContain("production");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("for");
  });

  it("deduplicates repeated words", () => {
    const tokens = tokenise("deploy deploy deploy");
    expect(tokens).toHaveLength(1);
  });

  it("returns empty array for blank / stopword-only input", () => {
    expect(tokenise("")).toHaveLength(0);
    expect(tokenise("the and for")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// recallForIssue — skills
// ---------------------------------------------------------------------------

describe("recallForIssue — skills", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = newDb();
  });

  it("returns skills whose name/description matches an issue keyword", () => {
    const skillRepo = createSkillsRepository(db);
    skillRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "database-migration",
      bodyPath: "/p/SKILL.md",
      description: "How to run database migrations safely",
      source: "user_authored",
    });
    skillRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "deploy-script",
      bodyPath: "/p/SKILL2.md",
      description: "CI/CD deployment pipeline steps",
      source: "user_authored",
    });

    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "Run database migration for the new schema",
    });

    const names = hits.skills.map((s) => s.name);
    expect(names).toContain("database-migration");
    // "deploy-script" shouldn't match (no keyword overlap)
    expect(names).not.toContain("deploy-script");
  });

  it("ignores skills with no keyword overlap", () => {
    const skillRepo = createSkillsRepository(db);
    skillRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "unrelated-skill",
      bodyPath: "/p/SKILL.md",
      description: "Something completely unrelated to the issue",
      source: "user_authored",
    });

    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "Fix TypeScript type errors in renderer",
    });

    // "unrelated" and "something" etc. won't appear in "Fix TypeScript type errors"
    const names = hits.skills.map((s) => s.name);
    expect(names).not.toContain("unrelated-skill");
  });

  it("pools company-shared skills alongside agent-private ones", () => {
    const skillRepo = createSkillsRepository(db);
    // private skill
    skillRepo.create({
      companyId: "c1",
      agentId: "a1",
      name: "private-typescript",
      bodyPath: "/p/SKILL.md",
      description: "TypeScript patterns for the agent",
      source: "user_authored",
    });
    // company-shared skill
    skillRepo.create({
      companyId: "c1",
      agentId: null,
      name: "shared-typescript",
      bodyPath: "/p/SKILL2.md",
      description: "Shared TypeScript best practices",
      source: "user_authored",
    });

    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "Refactor TypeScript interfaces",
    });

    const names = hits.skills.map((s) => s.name);
    expect(names).toContain("private-typescript");
    expect(names).toContain("shared-typescript");
  });

  it("respects limit", () => {
    const skillRepo = createSkillsRepository(db);
    for (let i = 0; i < 5; i++) {
      skillRepo.create({
        companyId: "c1",
        agentId: "a1",
        name: `typescript-skill-${String(i)}`,
        bodyPath: `/p/SKILL${String(i)}.md`,
        description: "TypeScript utility",
        source: "user_authored",
      });
    }

    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "TypeScript refactor",
      limit: 2,
    });

    expect(hits.skills.length).toBeLessThanOrEqual(2);
  });

  it("returns empty skills array when there are no skills in the DB", () => {
    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "Fix the authentication flow",
    });
    expect(hits.skills).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// recallForIssue — memories
// ---------------------------------------------------------------------------

describe("recallForIssue — memories", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = newDb();
  });

  it("returns a memory matching issue keywords via FTS", () => {
    const memRepo = createMemoriesRepository(db);
    memRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "Always run database migrations inside a transaction to avoid partial state",
    });
    memRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "Use async/await consistently across the codebase",
    });

    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "Run database migration for schema changes",
    });

    const bodies = hits.memories.map((m) => m.body);
    expect(bodies.some((b) => b.includes("database"))).toBe(true);
  });

  it("does not return irrelevant memories", () => {
    const memRepo = createMemoriesRepository(db);
    memRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "Always commit tests alongside feature code",
    });

    // Issue about database — "commit" appears in both but "database" is the key keyword
    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "Rewrite the authentication service using JWT",
    });

    // The memory body doesn't mention authentication or JWT
    const bodies = hits.memories.map((m) => m.body);
    expect(bodies.some((b) => b.includes("authentication") || b.includes("JWT"))).toBe(false);
  });

  it("returns empty memories when issue has no keyword matches", () => {
    const memRepo = createMemoriesRepository(db);
    memRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "Database connection pooling is critical for performance",
    });

    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "Fix TypeScript compilation errors in renderer process",
    });

    // "typescript" / "compilation" / "renderer" / "process" don't appear in that memory
    expect(hits.memories).toHaveLength(0);
  });

  it("returns empty arrays when DB has no memories and no skills", () => {
    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "Build a new feature",
    });
    expect(hits.skills).toEqual([]);
    expect(hits.memories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// recallForIssue — preference scoping (agent isolation)
// ---------------------------------------------------------------------------

describe("recallForIssue — preference scoping", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = newDb();
  });

  it("does NOT surface agent A's private memory in agent B's recall", () => {
    const memRepo = createMemoriesRepository(db);
    // Agent A's private preference
    memRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "preference",
      body: "docker deployment rollback procedure always required",
    });

    // Agent B recalls — should NOT see agent A's row
    const hits = recallForIssue(db, {
      companyId: "c1",
      agentId: "a2",
      issueText: "docker deployment rollback procedure",
    });

    expect(hits.memories).toHaveLength(0);
  });

  it("surfaces a company-wide memory for BOTH agents", () => {
    const memRepo = createMemoriesRepository(db);
    // Company-wide row (no agentId)
    memRepo.create({
      companyId: "c1",
      agentId: null,
      kind: "rule",
      body: "docker images must be pinned to a digest for reproducibility",
    });

    const hitsA = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "docker images pinned digest reproducibility",
    });
    const hitsB = recallForIssue(db, {
      companyId: "c1",
      agentId: "a2",
      issueText: "docker images pinned digest reproducibility",
    });

    expect(hitsA.memories.length).toBeGreaterThan(0);
    expect(hitsB.memories.length).toBeGreaterThan(0);
    expect(hitsA.memories[0]!.body).toContain("docker");
    expect(hitsB.memories[0]!.body).toContain("docker");
  });

  it("agent A sees its own private memory but agent B does not", () => {
    const memRepo = createMemoriesRepository(db);
    memRepo.create({
      companyId: "c1",
      agentId: "a1",
      kind: "preference",
      body: "redis cache warmup strategy must be incremental",
    });

    const hitsA = recallForIssue(db, {
      companyId: "c1",
      agentId: "a1",
      issueText: "redis cache warmup incremental strategy",
    });
    const hitsB = recallForIssue(db, {
      companyId: "c1",
      agentId: "a2",
      issueText: "redis cache warmup incremental strategy",
    });

    expect(hitsA.memories.some((m) => m.body.includes("redis"))).toBe(true);
    expect(hitsB.memories.some((m) => m.body.includes("redis"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatRecallSeed
// ---------------------------------------------------------------------------

describe("formatRecallSeed", () => {
  it("returns null for empty hits", () => {
    expect(formatRecallSeed({ skills: [], memories: [] })).toBeNull();
  });

  it("includes skill name and description when skills are present", () => {
    const seed = formatRecallSeed({
      skills: [{ name: "deploy-runbook", description: "How to deploy to production" }],
      memories: [],
    });
    expect(seed).not.toBeNull();
    expect(seed).toContain("deploy-runbook");
    expect(seed).toContain("How to deploy to production");
    expect(seed).toContain("CONHECIMENTO RELEVANTE");
  });

  it("includes memory body when memories are present", () => {
    const seed = formatRecallSeed({
      skills: [],
      memories: [{ body: "Always run migrations in a transaction" }],
    });
    expect(seed).not.toBeNull();
    expect(seed).toContain("Always run migrations in a transaction");
    expect(seed).toContain("CONHECIMENTO RELEVANTE");
  });

  it("includes both sections when both are non-empty", () => {
    const seed = formatRecallSeed({
      skills: [{ name: "deploy", description: "Deployment steps" }],
      memories: [{ body: "Use atomic deploys" }],
    });
    expect(seed).toContain("deploy");
    expect(seed).toContain("Use atomic deploys");
  });

  it("caps long body lines at 200 chars", () => {
    const longBody = "x".repeat(300);
    const seed = formatRecallSeed({ skills: [], memories: [{ body: longBody }] });
    // The line itself (after "- ") should contain the cap indicator
    expect(seed).toContain("…");
    // Total line length for the body entry should not be much longer than 200 + "- " + "…"
    const lines = (seed ?? "").split("\n");
    const bodyLine = lines.find((l) => l.startsWith("-"));
    expect(bodyLine!.length).toBeLessThanOrEqual(205);
  });

  it("omits skills section when skills array is empty", () => {
    const seed = formatRecallSeed({
      skills: [],
      memories: [{ body: "relevant memory" }],
    });
    expect(seed).not.toContain("skill_read");
  });

  it("omits memories section when memories array is empty", () => {
    const seed = formatRecallSeed({
      skills: [{ name: "myskill", description: "desc" }],
      memories: [],
    });
    expect(seed).not.toContain("Memórias");
  });
});
