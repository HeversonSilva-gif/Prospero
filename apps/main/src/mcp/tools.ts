import { z } from "zod";
import type Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createAgentsRepository } from "../agents/repository.js";
import { createMessagesRepository } from "../messages/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createProjectsRepository } from "../projects/repository.js";

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
    name: "list_projects",
    description:
      "List projects this agent has access to. Use this to discover absolute paths for the user's projects — your CWD is an empty sandbox dir, so file operations require absolute paths from here.",
    inputSchema: z.object({}),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (_input: unknown, ctx: ToolContext): Promise<string> => {
      const agents = createAgentsRepository(ctx.db);
      const projects = createProjectsRepository(ctx.db);
      const agent = agents.getById(ctx.agentId);
      if (agent === null) return JSON.stringify({ projects: [] });
      const all = projects.listByCompany(ctx.companyId);
      const visible =
        agent.allowedProjects.length === 0
          ? all
          : all.filter((p) => agent.allowedProjects.includes(p.id));
      return JSON.stringify({
        projects: visible.map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
          color: p.color,
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
    description: "Create a new issue. project may be a project ID or a project name.",
    inputSchema: z.object({
      project: z.string(),
      title: z.string().min(1),
      description: z.string().optional(),
      assignee: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      parent_id: z.string().optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: {
        project: string;
        title: string;
        description?: string;
        assignee?: string;
        priority?: "low" | "medium" | "high" | "urgent";
        parent_id?: string;
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const issues = createIssuesRepository(ctx.db);
      const lookup = issues.resolveProjectByNameOrId(ctx.companyId, input.project);
      if (lookup.matches === 0) return JSON.stringify({ ok: false, error: "project not found" });
      if (lookup.matches > 1)
        return JSON.stringify({ ok: false, error: "multiple projects match" });
      const created = issues.create(
        {
          companyId: ctx.companyId,
          projectId: lookup.id,
          title: input.title,
          description: input.description ?? null,
          assigneeId: input.assignee ?? null,
          priority: input.priority ?? "medium",
          parentId: input.parent_id ?? null,
          createdBy: ctx.agentId,
        },
        { actorKind: "agent", actorId: ctx.agentId },
      );
      ctx.emit({ kind: "issue.created", payload: { issueId: created.id } });
      return JSON.stringify({ id: created.id, title: created.title });
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
    name: "report_to_user",
    description:
      "Send a message to the user in this agent's main chat (the [user, this-agent] thread). Use this after a delegated agent reports back, to relay the result so the user sees it in the Chat tab. Without this call, your reply stays in the inter-agent Delegações tab and the user never sees it.",
    inputSchema: z.object({ content: z.string().min(1) }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: { content: string }, ctx: ToolContext): Promise<string> => {
      const messages = createMessagesRepository(ctx.db);
      const msg = messages.append({
        companyId: ctx.companyId,
        participants: ["user", ctx.agentId],
        senderKind: "agent",
        senderId: ctx.agentId,
        content: input.content,
      });
      ctx.emit({
        kind: "user.message-append",
        payload: { agentId: ctx.agentId, messageId: msg.id },
      });
      return JSON.stringify({ ok: true, message_id: msg.id });
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
    name: "update_issue",
    description: "Update fields of an issue. Status 'done' notifies the user via Inbox.",
    inputSchema: z.object({
      id: z.string(),
      status: z.enum(["backlog", "todo", "doing", "review", "done", "cancelled"]).optional(),
      description: z.string().optional(),
      title: z.string().optional(),
      assignee: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: {
        id: string;
        status?: "backlog" | "todo" | "doing" | "review" | "done" | "cancelled";
        description?: string;
        title?: string;
        assignee?: string;
        priority?: "low" | "medium" | "high" | "urgent";
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const issues = createIssuesRepository(ctx.db);
      const existing = issues.getById(input.id);
      if (existing === null || existing.companyId !== ctx.companyId) {
        return JSON.stringify({ ok: false, error: "issue not found" });
      }
      const patch: Parameters<typeof issues.update>[1] = {};
      if (input.status !== undefined) patch.status = input.status;
      if (input.description !== undefined) patch.description = input.description;
      if (input.title !== undefined) patch.title = input.title;
      if (input.assignee !== undefined) patch.assigneeId = input.assignee;
      if (input.priority !== undefined) patch.priority = input.priority;
      const next = issues.update(input.id, patch, { actorKind: "agent", actorId: ctx.agentId });
      if (next === null) return JSON.stringify({ ok: false, error: "issue not found" });
      if (input.status === "done") {
        const inbox = createInboxRepository(ctx.db);
        const caller = ctx.db.prepare("SELECT name FROM agents WHERE id = ?").get(ctx.agentId) as
          | { name: string }
          | undefined;
        inbox.create({
          companyId: ctx.companyId,
          kind: "completed",
          actorId: ctx.agentId,
          title: `${next.title} — done`,
          preview: caller !== undefined ? `marked done by ${caller.name}` : null,
          requiresAction: false,
          payloadJson: JSON.stringify({ issueId: next.id, byAgent: caller?.name ?? null }),
        });
      }
      ctx.emit({ kind: "issue.updated", payload: { issueId: next.id } });
      return JSON.stringify({ id: next.id, status: next.status });
    },
  },
  {
    name: "assign_issue",
    description: "Assign an issue to an agent.",
    inputSchema: z.object({ issue_id: z.string(), agent_id: z.string() }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: { issue_id: string; agent_id: string },
      ctx: ToolContext,
    ): Promise<string> => {
      const issues = createIssuesRepository(ctx.db);
      const existing = issues.getById(input.issue_id);
      if (existing === null || existing.companyId !== ctx.companyId) {
        return JSON.stringify({ ok: false, error: "issue not found" });
      }
      const targetAgent = ctx.db
        .prepare("SELECT id FROM agents WHERE id = ? AND company_id = ?")
        .get(input.agent_id, ctx.companyId) as { id: string } | undefined;
      if (targetAgent === undefined) {
        return JSON.stringify({ ok: false, error: "agent not found" });
      }
      const next = issues.update(
        input.issue_id,
        { assigneeId: input.agent_id },
        { actorKind: "agent", actorId: ctx.agentId },
      );
      if (next === null) return JSON.stringify({ ok: false, error: "issue not found" });
      ctx.emit({ kind: "issue.updated", payload: { issueId: next.id } });
      return JSON.stringify({ id: next.id, assignee: next.assigneeId });
    },
  },
  {
    name: "list_issues",
    description: "List issues with optional filters (project, status, assignee).",
    inputSchema: z.object({
      project: z.string().optional(),
      status: z.enum(["backlog", "todo", "doing", "review", "done", "cancelled"]).optional(),
      assignee: z.string().optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: {
        project?: string;
        status?: "backlog" | "todo" | "doing" | "review" | "done" | "cancelled";
        assignee?: string;
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const issues = createIssuesRepository(ctx.db);
      const filter: Parameters<typeof issues.list>[0] = { companyId: ctx.companyId };
      if (input.project !== undefined) {
        const lookup = issues.resolveProjectByNameOrId(ctx.companyId, input.project);
        if (lookup.matches !== 1)
          return JSON.stringify({ ok: false, error: "project lookup failed" });
        filter.projectId = lookup.id;
      }
      if (input.status !== undefined) filter.status = input.status;
      if (input.assignee !== undefined) filter.assigneeId = input.assignee;
      const list = issues.list(filter);
      return JSON.stringify({
        issues: list.map((i) => ({
          id: i.id,
          title: i.title,
          status: i.status,
          assignee: i.assigneeId,
          priority: i.priority,
        })),
      });
    },
  },
  {
    name: "check_status",
    description: "Get current status of an issue.",
    inputSchema: z.object({ issue_id: z.string() }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: { issue_id: string }, ctx: ToolContext): Promise<string> => {
      const issues = createIssuesRepository(ctx.db);
      const i = issues.getById(input.issue_id);
      if (i === null || i.companyId !== ctx.companyId)
        return JSON.stringify({ ok: false, error: "not found" });
      return JSON.stringify({
        id: i.id,
        status: i.status,
        assignee: i.assigneeId,
        updated_at: i.updatedAt,
      });
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
