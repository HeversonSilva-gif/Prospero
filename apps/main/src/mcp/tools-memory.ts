import { z } from "zod";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createMemoriesRepository } from "../memory/memories-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { getAgentMemoryDir, skillBodyPath } from "../memory/memory-dir.js";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";
import { toFtsMatchExpr } from "../memory/fts-query.js";
import { createRateLimiter } from "./rate-limiter.js";
import {
  OPERATING_MANUAL,
  OPERATING_MANUAL_NAME,
  OPERATING_MANUAL_DESCRIPTION,
} from "../orchestrator/operating-manual.js";
import { ALGORITHM, ALGORITHM_DESCRIPTION, ALGORITHM_NAME } from "../orchestrator/algorithm.js";
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
const memoryWriteLimiter = createRateLimiter(3, RATE_WINDOW_MS);

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
    // The bundled operating manual has no DB row — surface it like any skill.
    if (
      OPERATING_MANUAL_NAME.includes(q) ||
      OPERATING_MANUAL_DESCRIPTION.toLowerCase().includes(q)
    ) {
      skills.unshift({
        id: OPERATING_MANUAL_NAME,
        name: OPERATING_MANUAL_NAME,
        description: OPERATING_MANUAL_DESCRIPTION,
        shared: true,
      });
    }
    if (ALGORITHM_NAME.includes(q) || ALGORITHM_DESCRIPTION.toLowerCase().includes(q)) {
      skills.unshift({
        id: ALGORITHM_NAME,
        name: ALGORITHM_NAME,
        description: ALGORITHM_DESCRIPTION,
        shared: true,
      });
    }
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
    if (skill === null) {
      // The operating manual is a bundled document, not a row — serve it here.
      if (name === OPERATING_MANUAL_NAME) {
        return JSON.stringify({ name: OPERATING_MANUAL_NAME, version: 1, body: OPERATING_MANUAL });
      }
      if (name === ALGORITHM_NAME) {
        return JSON.stringify({ name: ALGORITHM_NAME, version: 1, body: ALGORITHM });
      }
      throw new Error(`skill not found: ${name}`);
    }
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
    if (name === OPERATING_MANUAL_NAME) {
      throw new Error(`"${OPERATING_MANUAL_NAME}" is a reserved bundled skill name`);
    }
    if (name === ALGORITHM_NAME) {
      throw new Error(`"${ALGORITHM_NAME}" is a reserved bundled skill name`);
    }
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
    repo.recordPatch(skill.id);
    return JSON.stringify({ id: updated.id, name: updated.name, version: updated.version });
  },
};

const skillPromote: Tool = {
  name: "skill_promote",
  description:
    "Request that one of your private skills be promoted to company-shared, so other agents inherit it. Files a request for the user to review and approve — it does NOT promote the skill immediately.",
  inputSchema: z.object({ name: z.string().min(1).max(120) }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { name } = skillPromote.inputSchema.parse(input) as { name: string };
    const skill = createSkillsRepository(ctx.db).getByName(ctx.companyId, ctx.agentId, name);
    if (skill === null) throw new Error(`private skill not found: ${name}`);
    if (skill.agentId === null) {
      throw new Error(`skill "${name}" is already company-shared`);
    }
    if (!skillWriteLimiter.tryConsume(ctx.agentId)) {
      throw new Error("skill write rate limit exceeded — try again shortly");
    }
    createInboxRepository(ctx.db).create({
      companyId: ctx.companyId,
      kind: "skill_promotion_requested",
      actorId: ctx.agentId,
      title: `Skill promotion requested: ${skill.name}`,
      preview: skill.description,
      requiresAction: true,
      payloadJson: JSON.stringify({ skillId: skill.id }),
    });
    return JSON.stringify({ requested: true, skillId: skill.id });
  },
};

const MEMORY_KIND = z.enum(["identity", "rule", "preference", "retrospective"]);
const MEMORY_SCOPE = z.enum(["agent", "company"]);

const memoryRead: Tool = {
  name: "memory_read",
  description:
    "List your declarative memory entries. Optionally filter by scope ('agent' = your own, 'company' = company-wide) and kind.",
  inputSchema: z.object({
    scope: MEMORY_SCOPE.optional(),
    kind: MEMORY_KIND.optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { scope, kind } = memoryRead.inputSchema.parse(input) as {
      scope?: "agent" | "company";
      kind?: string;
    };
    const repo = createMemoriesRepository(ctx.db);
    const rows =
      scope === "company" ? repo.listCompanyWide(ctx.companyId) : repo.listByAgent(ctx.agentId);
    const filtered = rows.filter((m) => kind === undefined || m.kind === kind);
    repo.recordAccess(filtered.map((m) => m.id));
    const memories = filtered.map((m) => ({
      id: m.id,
      kind: m.kind,
      body: m.body,
      importance: m.importance,
    }));
    return JSON.stringify({ memories });
  },
};

const memoryAdd: Tool = {
  name: "memory_add",
  description:
    "Add a short declarative memory entry (identity / rule / preference / retrospective). Prefer skill_create for procedural know-how — memory is for brief durable facts only.",
  inputSchema: z.object({
    kind: MEMORY_KIND,
    body: z.string().min(1).max(2000),
    importance: z.number().min(0).max(1).optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { kind, body, importance } = memoryAdd.inputSchema.parse(input) as {
      kind: "identity" | "rule" | "preference" | "retrospective";
      body: string;
      importance?: number;
    };
    assertSane(body);
    if (!memoryWriteLimiter.tryConsume(ctx.agentId)) {
      throw new Error("memory write rate limit exceeded — try again shortly");
    }
    const memory = createMemoriesRepository(ctx.db).create({
      companyId: ctx.companyId,
      agentId: ctx.agentId,
      kind,
      body,
      ...(importance !== undefined ? { importance } : {}),
    });
    return JSON.stringify({ id: memory.id });
  },
};

const memoryRemove: Tool = {
  name: "memory_remove",
  description: "Soft-delete one of your memory entries by id. Pinned entries cannot be removed.",
  inputSchema: z.object({ id: z.string().min(1) }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { id } = memoryRemove.inputSchema.parse(input) as { id: string };
    const repo = createMemoriesRepository(ctx.db);
    const memory = repo.getById(id);
    if (memory === null || memory.agentId !== ctx.agentId) {
      throw new Error(`memory not found: ${id}`);
    }
    if (memory.pinned) throw new Error("memory is pinned and read-only");
    repo.softDelete(id);
    return JSON.stringify({ removed: id });
  },
};

const memorySearch: Tool = {
  name: "memory_search",
  description:
    "Full-text search your memory entries by keyword. Returns ranked matches scoped to you.",
  inputSchema: z.object({
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { query, limit } = memorySearch.inputSchema.parse(input) as {
      query: string;
      limit?: number;
    };
    const repo = createMemoriesRepository(ctx.db);
    const safeQuery = toFtsMatchExpr(query);
    const rows =
      safeQuery === ""
        ? []
        : repo.search(safeQuery, {
            agentId: ctx.agentId,
            ...(limit !== undefined ? { limit } : {}),
          });
    repo.recordAccess(rows.map((m) => m.id));
    return JSON.stringify({
      memories: rows.map((m) => ({ id: m.id, kind: m.kind, body: m.body })),
    });
  },
};

const sessionSearch: Tool = {
  name: "session_search",
  description:
    "Full-text search your past conversation history by keyword. Use this to recall an earlier discussion without re-reading whole threads.",
  inputSchema: z.object({
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { query, limit } = sessionSearch.inputSchema.parse(input) as {
      query: string;
      limit?: number;
    };
    const rows = ctx.db
      .prepare(
        `SELECT m.id AS message_id, m.content AS content, m.created_at AS created_at
           FROM messages_fts f
           JOIN messages m ON m.id = f.message_id
          WHERE messages_fts MATCH ?
          ORDER BY rank
          LIMIT ?`,
      )
      .all(query, limit ?? 50) as Array<{
      message_id: string;
      content: string;
      created_at: number;
    }>;
    return JSON.stringify({
      results: rows.map((r) => ({
        messageId: r.message_id,
        content: r.content,
        createdAt: r.created_at,
      })),
    });
  },
};

export const memoryToolDefinitions: Tool[] = [
  skillSearch,
  skillRead,
  skillCreate,
  skillUpdate,
  skillPromote,
  memoryRead,
  memoryAdd,
  memoryRemove,
  memorySearch,
  sessionSearch,
];
