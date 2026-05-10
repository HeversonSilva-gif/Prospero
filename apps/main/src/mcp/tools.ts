import { z } from "zod";
import type Database from "better-sqlite3";

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
      ctx.emit({ kind: "list_agents.called", payload: { agentId: ctx.agentId } });
      return JSON.stringify({ ok: true, note: "M3 mock: returns nothing yet" });
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
