import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createAgentsRepository } from "../agents/repository.js";
import {
  readDigestAt,
  writeDigestAt,
  foldDeepDives,
  bumpEntryAccess,
} from "../context/digest-store.js";
import { projectDigestPath, agentDigestPath } from "../context/digest-dir.js";
import type { DeepDive } from "@prospero/shared";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";
import { createRateLimiter } from "./rate-limiter.js";
import type { ToolContext } from "./tools.js";

type Tool = {
  name: string;
  description: string;
  inputSchema: z.AnyZodObject;
  run: (input: unknown, ctx: ToolContext) => Promise<string>;
};

// One MCP server process per agent → module-level limiter is per-agent state.
// 2-minute window approximates the spec's "per turn" cap.
const noteLimiter = createRateLimiter(5, 120_000);
const NOTE_MAX = 8_192;

// Audit 2026-06-03 Inteligência & Contexto I10: resolve the digest these tools
// operate on. A single-project agent uses that project's digest; a CEO /
// multi-project agent (allowedProjects.length !== 1) has no single project to
// fold into, so it reads and annotates its OWN agent-scoped digest — the exact
// path compaction writes the CEO's durable knowledge to (agentDigestPath). This
// gives the CEO a tool to inspect/correct the digest that was previously
// inject-only. Returns the absolute digest.json path.
const resolveDigestPath = (ctx: ToolContext): string => {
  const agent = createAgentsRepository(ctx.db).getById(ctx.agentId);
  const soleProject =
    agent !== null && agent.allowedProjects.length === 1 ? agent.allowedProjects[0]! : null;
  return soleProject !== null
    ? projectDigestPath(ctx.userDataDir, ctx.companyId, soleProject)
    : agentDigestPath(ctx.userDataDir, ctx.companyId, ctx.agentId);
};

const projectContextRead: Tool = {
  name: "project_context_read",
  description:
    "Read this project's distilled context. With no args, returns the map (short facts about the codebase). With an area, returns the deep-dive note for that area. Use this to orient yourself before reading raw files.",
  inputSchema: z.object({
    area: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, "area must be lowercase kebab-case")
      .optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { area } = projectContextRead.inputSchema.parse(input) as { area?: string };
    const digestPath = resolveDigestPath(ctx);
    const digest = readDigestAt(digestPath);
    if (area === undefined) {
      return JSON.stringify({
        map: digest.entries.map((e) => ({ id: e.id, section: e.section, body: e.body })),
        areas: digest.deepDives.map((d) => d.area),
      });
    }
    const idx = digest.deepDives.findIndex((d) => d.area === area);
    if (idx < 0) return JSON.stringify({ deepDive: null });
    const bumped = bumpEntryAccess(digest.deepDives[idx]!, Date.now());
    digest.deepDives[idx] = bumped;
    writeDigestAt(digestPath, digest);
    return JSON.stringify({ deepDive: { area: bumped.area, body: bumped.body } });
  },
};

const projectContextNote: Tool = {
  name: "project_context_note",
  description:
    "Record or correct durable project knowledge. Writes a per-area deep-dive note (area = a short kebab-case topic like 'gate' or 'spawn-flow'). Pass supersedes=<entry id> when you are correcting a map entry you found wrong — it lowers that entry's trust.",
  inputSchema: z.object({
    area: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, "area must be lowercase kebab-case"),
    body: z.string().min(1).max(NOTE_MAX),
    supersedes: z.string().min(1).optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { area, body, supersedes } = projectContextNote.inputSchema.parse(input) as {
      area: string;
      body: string;
      supersedes?: string;
    };
    // The note body is injected verbatim into future system prompts (same path
    // as memory/skill bodies), so it must pass the prompt-injection sanitizer.
    const sane = sanitizeMemoryBody(body);
    if (!sane.ok) throw new Error(`body rejected by sanitizer: ${sane.reason}`);
    if (!noteLimiter.tryConsume(ctx.agentId)) {
      throw new Error("project context write rate limit exceeded — try again shortly");
    }
    // Audit 2026-06-03 Inteligência & Contexto I10: a CEO / multi-project agent
    // annotates its own agent-scoped digest instead of throwing.
    const digestPath = resolveDigestPath(ctx);
    const digest = readDigestAt(digestPath);
    // A supersedes target that doesn't exist would silently no-op the trust
    // decay — surface it as an error so the caller knows nothing was lowered.
    if (supersedes !== undefined && !digest.entries.some((e) => e.id === supersedes)) {
      throw new Error(`supersedes target "${supersedes}" not found in map entries`);
    }
    const dive: DeepDive = {
      id: `dd_${randomUUID()}`,
      area,
      body,
      sourceFiles: [],
      contentHash: "",
      derivedAt: Date.now(),
      trust: 0.6,
      accessCount: 0,
      lastAccessed: null,
    };
    const nextEntries =
      supersedes !== undefined
        ? digest.entries.map((e) =>
            e.id === supersedes ? { ...e, trust: Math.max(0, e.trust - 0.3) } : e,
          )
        : digest.entries;
    writeDigestAt(digestPath, {
      version: 1,
      entries: nextEntries,
      deepDives: foldDeepDives(digest.deepDives, [dive]),
    });
    return JSON.stringify({ ok: true, area, superseded: supersedes ?? null });
  },
};

export const projectContextToolDefinitions: Tool[] = [projectContextRead, projectContextNote];
