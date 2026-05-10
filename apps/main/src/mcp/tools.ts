import { z } from "zod";
import type Database from "better-sqlite3";
import { createAgentsRepository } from "../agents/repository.js";
import { createMessagesRepository } from "../messages/repository.js";

export type ToolContext = {
  agentId: string;
  companyId: string;
  db: Database.Database;
  permissionsDir: string;
  emit: (event: { kind: string; payload: unknown }) => void;
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
    description: "Hire a new agent with the given role.",
    inputSchema: z.object({ role: z.string(), name: z.string().optional() }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: { role: string; name?: string }, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "hire_agent.called", payload: input });
      return JSON.stringify({ ok: true, mocked: true, would_create: input });
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
    description: "Send a message directly to another agent.",
    inputSchema: z.object({ agent: z.string(), content: z.string() }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: unknown, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "message_agent.called", payload: input });
      return JSON.stringify({ ok: true, mocked: true, would_send: input });
    },
  },
  {
    name: "notify_user",
    description: "Push a notification to the user's inbox.",
    inputSchema: z.object({
      title: z.string(),
      body: z.string().optional(),
      requires_action: z.boolean().optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: unknown, ctx: ToolContext): Promise<string> => {
      ctx.emit({ kind: "notify_user.called", payload: input });
      return JSON.stringify({ ok: true, mocked: true });
    },
  },
] as const;
