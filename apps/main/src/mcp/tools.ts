import { z } from "zod";
import type Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createAgentsRepository } from "../agents/repository.js";
import { createMessagesRepository } from "../messages/repository.js";
import { createInboxRepository } from "../inbox/repository.js";

export type ToolContext = {
  agentId: string;
  companyId: string;
  db: Database.Database;
  permissionsDir: string;
  emit: (event: { kind: string; payload: unknown }) => void;
};

const safeUnlink = (p: string): void => {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best effort */
  }
};

export const waitForResolution = async (
  dir: string,
  toolUseId: string,
  timeoutMs: number,
): Promise<{ behavior: "allow" } | { behavior: "deny"; message: string }> => {
  const res = join(dir, `${toolUseId}.res.json`);
  const den = join(dir, `${toolUseId}.deny.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(res)) {
      const r = JSON.parse(readFileSync(res, "utf8")) as { behavior: "allow" };
      safeUnlink(res);
      return r;
    }
    if (existsSync(den)) {
      const d = JSON.parse(readFileSync(den, "utf8")) as { behavior: "deny"; message: string };
      safeUnlink(den);
      return d;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { behavior: "deny", message: "Approval timeout" };
};

export const toolDefinitions = [
  {
    name: "list_agents",
    description: "List all agents in the current company.",
    inputSchema: z.object({}),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (_input: unknown, ctx: ToolContext): Promise<string> => {
      const repo = createAgentsRepository(ctx.db);
      const agents = repo.listByCompany(ctx.companyId);
      return JSON.stringify({
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          status: a.status,
          current_action: a.currentAction,
        })),
      });
    },
  },
  {
    name: "read_thread",
    description: "Read messages between this agent and another agent.",
    inputSchema: z.object({ other_agent_id: z.string(), since: z.number().optional() }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: { other_agent_id: string; since?: number },
      ctx: ToolContext,
    ): Promise<string> => {
      const repo = createMessagesRepository(ctx.db);
      const all = repo.listByParticipants(ctx.companyId, [ctx.agentId, input.other_agent_id]);
      const filtered =
        input.since !== undefined ? all.filter((m) => m.createdAt > input.since!) : all;
      return JSON.stringify({
        messages: filtered.map((m) => ({
          sender_kind: m.senderKind,
          sender_id: m.senderId,
          content: m.content,
          created_at: m.createdAt,
        })),
      });
    },
  },
  {
    name: "hire_agent",
    description: "Hire a new agent with detailed name, role, and persona system_prompt.",
    inputSchema: z.object({
      name: z.string().min(1),
      role: z.string().min(1),
      system_prompt: z.string().min(20),
      mode: z.enum(["supervised", "auto"]).optional(),
      reports_to: z.string().optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: {
        name: string;
        role: string;
        system_prompt: string;
        mode?: "supervised" | "auto";
        reports_to?: string;
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const agents = createAgentsRepository(ctx.db);
      const messages = createMessagesRepository(ctx.db);
      const agent = agents.create({
        companyId: ctx.companyId,
        name: input.name,
        role: input.role,
        systemPrompt: input.system_prompt,
        mode: input.mode ?? "supervised",
        alwaysOn: false,
      });
      const reportsTo = input.reports_to ?? ctx.agentId;
      ctx.db.prepare("UPDATE agents SET reports_to = ? WHERE id = ?").run(reportsTo, agent.id);
      messages.ensureThread(ctx.companyId, [ctx.agentId, agent.id]);
      ctx.emit({ kind: "agent.spawn-needed", payload: { agentId: agent.id } });
      return JSON.stringify({ id: agent.id, name: agent.name, role: agent.role });
    },
  },
  {
    name: "fire_agent",
    description: "Remove an agent and kill its runner if alive.",
    inputSchema: z.object({ agent_id: z.string() }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: { agent_id: string }, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "agent.kill", payload: { agentId: input.agent_id } });
      ctx.db.prepare("DELETE FROM agents WHERE id = ?").run(input.agent_id);
      return JSON.stringify({ ok: true });
    },
  },
  {
    name: "create_issue",
    description: "Create a new issue assigned to an agent.",
    inputSchema: z.object({
      project: z.string(),
      title: z.string(),
      description: z.string().optional(),
      assignee: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: unknown, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "create_issue.called", payload: input });
      return JSON.stringify({ ok: true, mocked: true, would_create: input });
    },
  },
  {
    name: "message_agent",
    description: "Send a message to another agent (async fire-and-forget).",
    inputSchema: z.object({ agent_id: z.string(), content: z.string().min(1) }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: { agent_id: string; content: string },
      ctx: ToolContext,
    ): Promise<string> => {
      const agents = createAgentsRepository(ctx.db);
      const messages = createMessagesRepository(ctx.db);
      const sender = agents.getById(ctx.agentId);
      if (sender === null) {
        return JSON.stringify({ ok: false, error: "sender not found" });
      }
      const target = agents.getById(input.agent_id);
      if (target === null) {
        return JSON.stringify({ ok: false, error: "target not found" });
      }
      const msg = messages.append({
        companyId: ctx.companyId,
        participants: [ctx.agentId, input.agent_id],
        senderKind: "agent",
        senderId: ctx.agentId,
        content: input.content,
      });
      ctx.emit({
        kind: "agent.deliver",
        payload: {
          targetId: input.agent_id,
          threadId: msg.threadId,
          senderName: sender.name,
          senderId: sender.id,
          content: input.content,
        },
      });
      return JSON.stringify({ queued: true, message_id: msg.id });
    },
  },
  {
    name: "notify_user",
    description: "Push a notification to the user's Inbox.",
    inputSchema: z.object({
      title: z.string().min(1),
      body: z.string().optional(),
      kind: z.enum(["completed", "suggestion", "error", "security_alert"]).optional(),
      requires_action: z.boolean().optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: {
        title: string;
        body?: string;
        kind?: "completed" | "suggestion" | "error" | "security_alert";
        requires_action?: boolean;
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const inbox = createInboxRepository(ctx.db);
      inbox.create({
        companyId: ctx.companyId,
        kind: input.kind ?? "completed",
        actorId: ctx.agentId,
        title: input.title,
        preview: input.body ?? null,
        requiresAction: input.requires_action ?? false,
      });
      return JSON.stringify({ ok: true });
    },
  },
  {
    name: "request_permission",
    description: "(internal) permission gate — claude calls this before each side-effect tool.",
    // Claude Code sends the gated tool's actual input under the key `input` (not
    // `tool_input`). The tool_use_id may also arrive under `permission_request_id`
    // or `tool_use_id` depending on version. We accept both via z.unknown() and
    // normalize at runtime.
    inputSchema: z.object({
      tool_name: z.string(),
      input: z.record(z.unknown()).optional(),
      tool_input: z.unknown().optional(),
      tool_use_id: z.string().optional(),
      permission_request_id: z.string().optional(),
    }),
    run: async (
      rawInput: {
        tool_name: string;
        input?: Record<string, unknown>;
        tool_input?: unknown;
        tool_use_id?: string;
        permission_request_id?: string;
      },
      ctx: ToolContext,
    ): Promise<string> => {
      // Normalize input — claude code sends gated tool input under `input` (current
      // SDK) or `tool_input` (older docs). Use whichever is present, defaulting to
      // empty object so updatedInput is always a valid record.
      const toolInput: Record<string, unknown> =
        rawInput.input ??
        (typeof rawInput.tool_input === "object" && rawInput.tool_input !== null
          ? (rawInput.tool_input as Record<string, unknown>)
          : {});
      const toolUseId = rawInput.tool_use_id ?? rawInput.permission_request_id ?? "unknown";
      const reqPath = join(ctx.permissionsDir, `${toolUseId}.req.json`);
      writeFileSync(
        reqPath,
        JSON.stringify({
          tool_use_id: toolUseId,
          agentId: ctx.agentId,
          tool_name: rawInput.tool_name,
          tool_input: toolInput,
        }),
      );
      const result = await waitForResolution(ctx.permissionsDir, toolUseId, 30 * 60_000);
      safeUnlink(reqPath);
      // Claude Code's --permission-prompt-tool requires `updatedInput` (a Record) on
      // allow responses. Without it, the response fails Zod validation on claude's
      // side and the gated tool gets an "invalid_union" error.
      if (result.behavior === "allow") {
        return JSON.stringify({ behavior: "allow", updatedInput: toolInput });
      }
      return JSON.stringify(result);
    },
  },
] as const;
