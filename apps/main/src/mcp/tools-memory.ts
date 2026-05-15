import { z } from "zod";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { getAgentMemoryDir, skillBodyPath } from "../memory/memory-dir.js";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";
import { createRateLimiter } from "./rate-limiter.js";
import type { ToolContext } from "./tools.js";

type Tool = {
  name: string;
  description: string;
  inputSchema: z.AnyZodObject;
  run: (input: unknown, ctx: ToolContext) => Promise<string>;
};

// One MCP server process per agent → module-level limiters are per-agent state.
// 2-minute window approximates the spec's "per turn" cap (the MCP subprocess
// cannot observe turn boundaries).
const RATE_WINDOW_MS = 120_000;
const skillWriteLimiter = createRateLimiter(5, RATE_WINDOW_MS);

const SKILL_BODY_MAX = 16_384;

const assertSane = (body: string): void => {
  const result = sanitizeMemoryBody(body);
  if (!result.ok) throw new Error(`body rejected by sanitizer: ${result.reason}`);
};

const skillSearch: Tool = {
  name: "skill_search",
  description:
    "Search your skills (procedural know-how docs) by keyword. Returns each match's name and one-line description. Call this at the start of a task to find a relevant skill, then skill_read it.",
  inputSchema: z.object({ query: z.string().min(1).max(200) }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { query } = skillSearch.inputSchema.parse(input) as { query: string };
    const repo = createSkillsRepository(ctx.db);
    const q = query.toLowerCase();
    const pool = [...repo.listByAgent(ctx.agentId), ...repo.listCompanyShared(ctx.companyId)];
    const skills = pool
      .filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        shared: s.agentId === null,
      }));
    return JSON.stringify({ skills });
  },
};

const skillRead: Tool = {
  name: "skill_read",
  description:
    "Read the full body of one of your skills by name. Records the skill as used. Use this after skill_search finds a relevant skill.",
  inputSchema: z.object({ name: z.string().min(1).max(120) }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { name } = skillRead.inputSchema.parse(input) as { name: string };
    const repo = createSkillsRepository(ctx.db);
    const skill =
      repo.getByName(ctx.companyId, ctx.agentId, name) ?? repo.getByName(ctx.companyId, null, name);
    if (skill === null) throw new Error(`skill not found: ${name}`);
    const body = readFileSync(skill.bodyPath, "utf8");
    repo.recordUse(skill.id);
    return JSON.stringify({ name: skill.name, version: skill.version, body });
  },
};

const skillCreate: Tool = {
  name: "skill_create",
  description:
    "Create a new private skill — a reusable procedural know-how doc. Use this after completing a non-trivial task to capture how you did it. name is a short kebab-case id; description is one line; body is markdown.",
  inputSchema: z.object({
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, "name must be lowercase kebab-case"),
    description: z.string().min(1).max(200),
    body: z.string().min(1).max(SKILL_BODY_MAX),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { name, description, body } = skillCreate.inputSchema.parse(input) as {
      name: string;
      description: string;
      body: string;
    };
    assertSane(body);
    assertSane(description);
    if (!skillWriteLimiter.tryConsume(ctx.agentId)) {
      throw new Error("skill write rate limit exceeded — try again shortly");
    }
    const repo = createSkillsRepository(ctx.db);
    if (repo.getByName(ctx.companyId, ctx.agentId, name) !== null) {
      throw new Error(`a skill named "${name}" already exists — use skill_update or a new name`);
    }
    const scopeDir = getAgentMemoryDir(ctx.userDataDir, ctx.companyId, ctx.agentId);
    const bodyPath = skillBodyPath(scopeDir, name);
    mkdirSync(dirname(bodyPath), { recursive: true });
    writeFileSync(bodyPath, body, "utf8");
    const skill = repo.create({
      companyId: ctx.companyId,
      agentId: ctx.agentId,
      name,
      bodyPath,
      description,
      source: "agent_created",
    });
    return JSON.stringify({ id: skill.id, name: skill.name, bodyPath: skill.bodyPath });
  },
};

const skillUpdate: Tool = {
  name: "skill_update",
  description:
    "Replace the body of one of your existing private skills by name. Increments its version. Use this when you learn a better way to do something you already captured.",
  inputSchema: z.object({
    name: z.string().min(1).max(120),
    body: z.string().min(1).max(SKILL_BODY_MAX),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { name, body } = skillUpdate.inputSchema.parse(input) as { name: string; body: string };
    assertSane(body);
    if (!skillWriteLimiter.tryConsume(ctx.agentId)) {
      throw new Error("skill write rate limit exceeded — try again shortly");
    }
    const repo = createSkillsRepository(ctx.db);
    const skill = repo.getByName(ctx.companyId, ctx.agentId, name);
    if (skill === null) throw new Error(`private skill not found: ${name}`);
    if (skill.promoted) throw new Error(`skill "${name}" is company-promoted and read-only`);
    writeFileSync(skill.bodyPath, body, "utf8");
    const updated = repo.update(skill.id, {});
    return JSON.stringify({ id: updated.id, name: updated.name, version: updated.version });
  },
};

export const memoryToolDefinitions: Tool[] = [skillSearch, skillRead, skillCreate, skillUpdate];
