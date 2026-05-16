import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../../src/db/migrations.js";
import { createMemoriesRepository } from "../../src/memory/memories-repository.js";
import { createSkillsRepository } from "../../src/memory/skills-repository.js";
import { buildMemoryBlock } from "../../src/orchestrator/system-prompt-memory.js";
import { composeSystemPrompt } from "../../src/orchestrator/system-prompt.js";

describe("M11 memory injection — assembler to system prompt", () => {
  it("a created memory surfaces in the composed system prompt", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1','Acme',0)").run();
    db.prepare(
      `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json,
         allowed_projects_json, mode, always_on, status, created_at, updated_at)
       VALUES ('a1','c1','Eng','engineer','sp','[]','[]','supervised',0,'idle',0,0)`,
    ).run();
    createMemoriesRepository(db).create({
      companyId: "c1",
      agentId: "a1",
      kind: "rule",
      body: "INJECTED-RULE-MARKER",
    });
    const memoryBlock = buildMemoryBlock({
      memoriesRepo: createMemoriesRepository(db),
      skillsRepo: createSkillsRepository(db),
      userDataDir: mkdtempSync(join(tmpdir(), "prospero-int-")),
      companyId: "c1",
      agentId: "a1",
      role: "engineer",
    });
    expect(memoryBlock).toBeDefined();
    const prompt = composeSystemPrompt({
      agentPersona: "You are an engineer.",
      capabilities: [],
      preambleOverride: "PRE\n",
      ...(memoryBlock !== undefined ? { memoryBlock } : {}),
    });
    expect(prompt).toContain("INJECTED-RULE-MARKER");
    expect(prompt).toContain("# Memory & skills");
  });
});
