import { z } from "zod";
import type Database from "better-sqlite3";
import type { HireAgentInput } from "@prospero/shared";
import { isCeoAgent } from "@prospero/shared";
import { HIRE_AGENT_INPUT_SCHEMA } from "../schemas/hire-agent-input.js";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { XPostEventResult } from "../connections/x-post-event.js";
import type { StripeSetupEventResult } from "../connections/stripe-setup-event.js";
import type { StripeChargeItem } from "../connections/stripe-monetization-executor.js";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { createMessagesRepository } from "../messages/repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { createIssuesRepository } from "../issues/repository.js";
import { createProjectsRepository } from "../projects/repository.js";
import { createSettingsRepository } from "../settings/repository.js";
import { createApprovalsRepository } from "../approvals/repository.js";
import {
  deferredMarkerPath,
  preapprovalKey,
  preapprovalPath,
} from "../approvals/deferred-approval.js";
import { createArtifactsRepository } from "../artifacts/repository.js";
import { tryGetRecorder } from "../activity/index.js";
import { recomputeAgentTrust } from "../trust/engine.js";
import type { ManagerTopic } from "../approvals/types.js";
import { createXPostsRepository } from "../connections/x-posts-repository.js";
import { createXMetricsRepository } from "../connections/x-metrics-repository.js";
import { buildXInsights } from "../connections/x-insights.js";

export type ToolContext = {
  agentId: string;
  companyId: string;
  db: Database.Database;
  permissionsDir: string;
  userDataDir: string;
  emit: (event: { kind: string; payload: unknown }) => void;
};

const safeUnlink = (p: string): void => {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* best effort */
  }
};

const resolveIssueIdOrIdentifier = (
  db: Database.Database,
  raw: string,
  companyId: string,
): string | null => {
  const repo = createIssuesRepository(db);
  if (raw.startsWith("iss_")) {
    const direct = repo.getById(raw);
    return direct !== null && direct.companyId === companyId ? direct.id : null;
  }
  const byIdent = repo.getByIdentifier(raw);
  return byIdent !== null && byIdent.companyId === companyId ? byIdent.id : null;
};

export const waitForResolution = async (
  dir: string,
  toolUseId: string,
  timeoutMs: number,
): Promise<
  | { behavior: "allow"; decidedBy?: string }
  | { behavior: "deny"; message: string; decidedBy?: string }
  | { behavior: "deferred"; decidedBy?: string }
> => {
  const res = join(dir, `${toolUseId}.res.json`);
  const den = join(dir, `${toolUseId}.deny.json`);
  // The scheduler writes this to reclaim the slot from a long-blocked agent
  // WITHOUT killing it mid-call: the poll returns, the turn ends cleanly, and
  // the approval stays pending for a real decision later (v0.1.37 wake fix).
  const defer = join(dir, `${toolUseId}.defer.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(res)) {
      const r = JSON.parse(readFileSync(res, "utf8")) as { behavior: "allow"; decidedBy?: string };
      safeUnlink(res);
      return r;
    }
    if (existsSync(den)) {
      const d = JSON.parse(readFileSync(den, "utf8")) as {
        behavior: "deny";
        message: string;
        decidedBy?: string;
      };
      safeUnlink(den);
      return d;
    }
    if (existsSync(defer)) {
      safeUnlink(defer);
      return { behavior: "deferred" };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { behavior: "deny", message: "Approval timeout" };
};

type GateOutcome =
  | { decision: "allow" }
  | { decision: "deny"; message: string }
  | { decision: "deferred"; message: string };

const GATE_DEFERRED_MESSAGE =
  "Aprovação ainda pendente — pausando para liberar um slot de execução. " +
  "Encerre o turno; você será reativado e esta ação será reexecutada assim que " +
  "a aprovação for decidida. Não tente contornar a permissão.";

// Routes a side-effect action through the approval gate — the SAME machinery the
// filesystem permission-prompt uses (create approval row → write the .req.json the
// permission watcher reads → block until the user/CEO decides). Shared by
// `request_permission` (claude's filesystem prompt) AND by the outward connector
// tools (post_to_x / reply_on_x). The connector tools call this directly so they
// SELF-GATE: they cannot publish without an approval regardless of how claude-code
// routes MCP-tool permissions (a tool in --allowedTools is otherwise run with no
// prompt — see prepare-sandbox.ts). One-shot pre-approval fences (deferred →
// approved re-attempts) and slot-reclaim defers are honoured here for both callers.
const gateAction = async (
  ctx: ToolContext,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId: string,
): Promise<GateOutcome> => {
  // One-shot pre-approval (v0.1.37 slot-reclaim re-execution): a deferred approval
  // that was later APPROVED leaves a pre-approval fence for the exact same action.
  // The re-attempt consumes it and is allowed without a fresh gate.
  const preKey = preapprovalKey(toolName, toolInput);
  const prePath = preapprovalPath(ctx.permissionsDir, ctx.agentId, preKey);
  if (existsSync(prePath)) {
    safeUnlink(prePath);
    return { decision: "allow" };
  }

  const approvals = createApprovalsRepository(ctx.db);
  const approval = approvals.create({
    agentId: ctx.agentId,
    kind: "tool_call",
    payload: { tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId },
  });
  tryGetRecorder()?.recordActivity({
    companyId: ctx.companyId,
    actor: { kind: "agent", id: ctx.agentId },
    action: "approval.requested",
    entityKind: "approval",
    entityId: approval.id,
    agentId: ctx.agentId,
    payload: { kind: "tool_call", toolName },
  });

  const reqPath = join(ctx.permissionsDir, `${toolUseId}.req.json`);
  writeFileSync(
    reqPath,
    JSON.stringify({
      tool_use_id: toolUseId,
      agentId: ctx.agentId,
      tool_name: toolName,
      tool_input: toolInput,
    }),
  );
  const result = await waitForResolution(ctx.permissionsDir, toolUseId, 30 * 60_000);
  // Deferred: the scheduler reclaimed the slot. Leave the approval PENDING (no
  // decide, no trust recompute) and keep req.json so it stays decidable; leave a
  // marker so MAIN's re-engagement sweep wakes this agent once the still-pending
  // approval is actually decided.
  if (result.behavior === "deferred") {
    try {
      writeFileSync(
        deferredMarkerPath(ctx.permissionsDir, approval.id),
        JSON.stringify({
          approvalId: approval.id,
          agentId: ctx.agentId,
          toolName,
          toolInput,
          toolUseId,
        }),
      );
    } catch {
      /* best-effort; without the marker the approval still resolves normally */
    }
    return { decision: "deferred", message: GATE_DEFERRED_MESSAGE };
  }
  approvals.decide(
    approval.id,
    result.behavior === "allow" ? "approved" : "rejected",
    result.decidedBy ?? "user",
    result.behavior === "deny" ? result.message : undefined,
  );
  // A user decision is a track-record signal — recompute the calling agent's trust
  // ladder. Idempotent + try/catch so a trust failure can never break the gate.
  try {
    recomputeAgentTrust(ctx.db, ctx.agentId);
  } catch (err) {
    console.warn("[approval] recomputeAgentTrust failed", err);
  }
  safeUnlink(reqPath);
  return result.behavior === "allow"
    ? { decision: "allow" }
    : { decision: "deny", message: result.message };
};

// Polls for the result the MAIN-process `x.post` handler writes back (keyed by
// postId) so post_to_x / reply_on_x return the tweet URL — or a clear error — to
// the agent in the same turn. Mirrors waitForResolution's fence-file pattern.
const waitForXResult = async (
  dir: string,
  postId: string,
  timeoutMs: number,
): Promise<XPostEventResult> => {
  const path = join(dir, `${postId}.xpost.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      const r = JSON.parse(readFileSync(path, "utf8")) as XPostEventResult;
      safeUnlink(path);
      return r;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, error: "Tempo esgotado aguardando a publicação no X." };
};

// Emits the `x.post` event MAIN reacts to (only MAIN holds the safeStorage cipher
// to decrypt the company's token), then waits for the result. Called ONLY after
// gateAction has approved the outward tool call.
const runXPost = async (
  ctx: ToolContext,
  args: { text: string; inReplyToId?: string },
): Promise<string> => {
  const postId = randomUUID();
  ctx.emit({
    kind: "x.post",
    payload:
      args.inReplyToId !== undefined
        ? { postId, text: args.text, inReplyToId: args.inReplyToId }
        : { postId, text: args.text },
  });
  const result = await waitForXResult(ctx.permissionsDir, postId, 90_000);
  return JSON.stringify(result);
};

// Polls for the result the MAIN-process `stripe.setup` handler writes back (keyed by
// requestId) so setup_monetization / create_payment_link return the payment link — or
// a clear error — to the agent in the same turn. Mirrors waitForXResult.
const waitForStripeResult = async (
  dir: string,
  requestId: string,
  timeoutMs: number,
): Promise<StripeSetupEventResult> => {
  const path = join(dir, `${requestId}.stripe.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      const r = JSON.parse(readFileSync(path, "utf8")) as StripeSetupEventResult;
      safeUnlink(path);
      return r;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, error: "Tempo esgotado aguardando a configuração no Stripe." };
};

// Emits the `stripe.setup` event MAIN reacts to (only MAIN holds the safeStorage
// cipher to decrypt the company's restricted key), then waits for the result. Called
// ONLY after gateAction has approved the money-moving tool call.
const runStripeSetup = async (ctx: ToolContext, items: StripeChargeItem[]): Promise<string> => {
  const requestId = randomUUID();
  ctx.emit({ kind: "stripe.setup", payload: { requestId, items } });
  const result = await waitForStripeResult(ctx.permissionsDir, requestId, 90_000);
  return JSON.stringify(result);
};

export const toolDefinitions = [
  {
    name: "list_agents",
    description: "List all agents in the current company.",
    inputSchema: z.object({}),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (_input: unknown, ctx: ToolContext): Promise<string> => {
      const repo = createAgentsRepository(ctx.db, tryGetRecorder());
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
      const agents = createAgentsRepository(ctx.db, tryGetRecorder());
      const projects = createProjectsRepository(ctx.db, tryGetRecorder());
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
    description:
      "Hire a new agent. Optionally pass role_template_id (e.g. 'role-engineer') to seed capabilities + model from a role.",
    inputSchema: HIRE_AGENT_INPUT_SCHEMA,
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: HireAgentInput, ctx: ToolContext): Promise<string> => {
      const agents = createAgentsRepository(ctx.db, tryGetRecorder());
      const messages = createMessagesRepository(ctx.db);
      const settings = createSettingsRepository(ctx.db).read();

      // Resolve role template if provided. Skip silently if id is unknown
      // (defensive — agent gets empty capabilities + settings default model).
      let roleCapabilities: string[] = [];
      let roleModel: string | null = null;
      let templateId: string | null = null;
      if (input.role_template_id !== undefined) {
        const row = ctx.db
          .prepare(
            "SELECT default_capabilities_json, default_model FROM role_templates WHERE id = ?",
          )
          .get(input.role_template_id) as
          | { default_capabilities_json: string; default_model: string }
          | undefined;
        if (row !== undefined) {
          roleCapabilities = JSON.parse(row.default_capabilities_json) as string[];
          roleModel = row.default_model;
          templateId = input.role_template_id;
        }
      }

      const agent = agents.create({
        companyId: ctx.companyId,
        name: input.name,
        role: input.role,
        systemPrompt: input.system_prompt,
        mode: input.mode ?? "supervised",
        alwaysOn: false,
        model: roleModel ?? settings.defaultModelForNewAgents,
        capabilities: roleCapabilities,
        templateId,
        actor: { kind: "agent", id: ctx.agentId },
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
      const target = ctx.db
        .prepare("SELECT id, company_id FROM agents WHERE id = ?")
        .get(input.agent_id) as { id: string; company_id: string } | undefined;
      ctx.emit({ kind: "agent.kill", payload: { agentId: input.agent_id } });
      ctx.db.prepare("DELETE FROM agents WHERE id = ?").run(input.agent_id);
      if (target !== undefined) {
        tryGetRecorder()?.recordActivity({
          companyId: target.company_id,
          actor: { kind: "agent", id: ctx.agentId },
          action: "agent.terminated",
          entityKind: "agent",
          entityId: input.agent_id,
          agentId: input.agent_id,
          payload: { reason: "fire_agent invoked" },
        });
      }
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
      const issues = createIssuesRepository(ctx.db, tryGetRecorder());
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
      return JSON.stringify({
        id: created.id,
        identifier: created.identifier,
        title: created.title,
      });
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
      const agents = createAgentsRepository(ctx.db, tryGetRecorder());
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
      const issues = createIssuesRepository(ctx.db, tryGetRecorder());
      const resolved = resolveIssueIdOrIdentifier(ctx.db, input.id, ctx.companyId);
      if (resolved === null) {
        return JSON.stringify({ ok: false, error: "issue not found" });
      }
      const existing = issues.getById(resolved);
      if (existing === null) {
        return JSON.stringify({ ok: false, error: "issue not found" });
      }
      const patch: Parameters<typeof issues.update>[1] = {};
      if (input.status !== undefined) patch.status = input.status;
      if (input.description !== undefined) patch.description = input.description;
      if (input.title !== undefined) patch.title = input.title;
      if (input.assignee !== undefined) patch.assigneeId = input.assignee;
      if (input.priority !== undefined) patch.priority = input.priority;
      const next = issues.update(resolved, patch, { actorKind: "agent", actorId: ctx.agentId });
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
      let warning: string | undefined;
      if (input.status === "done") {
        const artifacts = createArtifactsRepository(ctx.db);
        if (artifacts.countForIssue(resolved) === 0) {
          warning =
            "Issue marked done without recording an artifact. Use `record_artifact` to attach a commit SHA, PR URL, file path, or output text for the audit trail.";
        }
      }
      const response: { id: string; status: string; warning?: string } = {
        id: next.id,
        status: next.status,
      };
      if (warning !== undefined) response.warning = warning;
      return JSON.stringify(response);
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
      const issues = createIssuesRepository(ctx.db, tryGetRecorder());
      const resolved = resolveIssueIdOrIdentifier(ctx.db, input.issue_id, ctx.companyId);
      if (resolved === null) {
        return JSON.stringify({ ok: false, error: "issue not found" });
      }
      const targetAgent = ctx.db
        .prepare("SELECT id FROM agents WHERE id = ? AND company_id = ?")
        .get(input.agent_id, ctx.companyId) as { id: string } | undefined;
      if (targetAgent === undefined) {
        return JSON.stringify({ ok: false, error: "agent not found" });
      }
      const next = issues.update(
        resolved,
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
      const issues = createIssuesRepository(ctx.db, tryGetRecorder());
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
          identifier: i.identifier,
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
      const resolved = resolveIssueIdOrIdentifier(ctx.db, input.issue_id, ctx.companyId);
      if (resolved === null) return JSON.stringify({ ok: false, error: "not found" });
      const issues = createIssuesRepository(ctx.db, tryGetRecorder());
      const i = issues.getById(resolved);
      if (i === null) return JSON.stringify({ ok: false, error: "not found" });
      return JSON.stringify({
        id: i.id,
        identifier: i.identifier,
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

      const outcome = await gateAction(ctx, rawInput.tool_name, toolInput, toolUseId);
      // Claude Code's --permission-prompt-tool requires `updatedInput` (a Record) on
      // allow responses. Without it, the response fails Zod validation on claude's
      // side and the gated tool gets an "invalid_union" error. Deny + deferred both
      // surface as a deny-style turn-ending signal (claude accepts only allow/deny).
      if (outcome.decision === "allow") {
        return JSON.stringify({ behavior: "allow", updatedInput: toolInput });
      }
      return JSON.stringify({ behavior: "deny", message: outcome.message });
    },
  },
  {
    name: "post_to_x",
    description:
      "Publish a tweet on the company's connected X account. The text is reviewed via the " +
      "approval gate before it goes live (graduates to automatic as the agent earns trust). " +
      "Returns the published tweet's URL, or a clear error if X isn't connected / was rejected.",
    inputSchema: z.object({ text: z.string().min(1).max(4000) }),
    run: async (input: { text: string }, ctx: ToolContext): Promise<string> => {
      const toolInput = { text: input.text };
      const outcome = await gateAction(ctx, "post_to_x", toolInput, randomUUID());
      if (outcome.decision !== "allow") {
        return JSON.stringify({ ok: false, status: outcome.decision, message: outcome.message });
      }
      return runXPost(ctx, { text: input.text });
    },
  },
  {
    name: "reply_on_x",
    description:
      "Reply to a tweet on the company's connected X account (pass the id of the tweet you are " +
      "replying to). Reviewed via the approval gate before it goes live (auto once trusted). " +
      "Returns the reply's tweet URL, or a clear error if X isn't connected / was rejected.",
    inputSchema: z.object({ tweet_id: z.string().min(1), text: z.string().min(1).max(4000) }),
    run: async (input: { tweet_id: string; text: string }, ctx: ToolContext): Promise<string> => {
      const toolInput = { tweet_id: input.tweet_id, text: input.text };
      const outcome = await gateAction(ctx, "reply_on_x", toolInput, randomUUID());
      if (outcome.decision !== "allow") {
        return JSON.stringify({ ok: false, status: outcome.decision, message: outcome.message });
      }
      return runXPost(ctx, { text: input.text, inReplyToId: input.tweet_id });
    },
  },
  {
    name: "x_insights_read",
    description:
      "Read a 'what's working' digest of the company's X account (follower trend + top posts by " +
      "engagement) from the ingested metrics. Read-only — use it before composing a post to inform strategy.",
    inputSchema: z.object({ days: z.number().int().positive().max(90).optional() }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: { days?: number }, ctx: ToolContext): Promise<string> => {
      const windowMs = (input.days ?? 30) * 24 * 60 * 60_000;
      const since = Date.now() - windowMs;
      const posts = createXPostsRepository(ctx.db).recentByCompany(ctx.companyId, since);
      const metrics = createXMetricsRepository(ctx.db);
      const latest = metrics.latestPerTweet(ctx.companyId, since);
      const metricById = new Map(latest.map((m) => [m.tweetId, m]));
      return buildXInsights({
        accountSeries: metrics.accountSeries(ctx.companyId, since),
        posts: posts.map((p) => ({
          tweetId: p.tweetId,
          text: p.text,
          metric: metricById.get(p.tweetId) ?? null,
        })),
      });
    },
  },
  {
    name: "setup_monetization",
    description:
      "Set up the company's APPROVED charge model in Stripe: creates the product(s), price(s), and a hosted payment link from the pricing the owner approved in the business plan. Gated for approval first (auto once trusted). Returns the payment link URL, or a clear error if Stripe isn't connected / there is no approved pricing / it was rejected.",
    inputSchema: z.object({}),
    run: async (_input: unknown, ctx: ToolContext): Promise<string> => {
      const plan = createBusinessPlansRepository(ctx.db).getLatestApprovedForCompany(ctx.companyId);
      const pricing = plan?.pricing ?? null;
      if (pricing === null || pricing.items.length === 0) {
        return JSON.stringify({
          ok: false,
          error:
            "Nenhum modelo de cobrança aprovado. Defina a cobrança no plano de negócio e aprove primeiro.",
        });
      }
      const items: StripeChargeItem[] = pricing.items.map((it) => ({
        name: it.name,
        description: it.description,
        amount: it.amount,
        currency: it.currency,
        ...(it.interval !== undefined ? { interval: it.interval } : {}),
      }));
      const outcome = await gateAction(ctx, "setup_monetization", { items }, randomUUID());
      if (outcome.decision !== "allow") {
        return JSON.stringify({ ok: false, status: outcome.decision, message: outcome.message });
      }
      return runStripeSetup(ctx, items);
    },
  },
  {
    name: "create_payment_link",
    description:
      "Create a single ad-hoc Stripe payment link for one offering (name, amount in the smallest currency unit e.g. 900 = R$9,00, 3-letter currency; pass interval only for a recurring subscription). Gated for approval first (auto once trusted). Returns the payment link URL, or a clear error if Stripe isn't connected / was rejected.",
    inputSchema: z.object({
      name: z.string().min(1).max(120),
      description: z.string().min(1).max(500).optional(),
      amount: z.number().int().positive().max(99_999_999),
      currency: z.string().length(3),
      interval: z.enum(["month", "year"]).optional(),
    }),
    run: async (
      input: {
        name: string;
        description?: string;
        amount: number;
        currency: string;
        interval?: "month" | "year";
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const item: StripeChargeItem = {
        name: input.name,
        description: input.description ?? input.name,
        amount: input.amount,
        currency: input.currency,
        ...(input.interval !== undefined ? { interval: input.interval } : {}),
      };
      const outcome = await gateAction(ctx, "create_payment_link", { item }, randomUUID());
      if (outcome.decision !== "allow") {
        return JSON.stringify({ ok: false, status: outcome.decision, message: outcome.message });
      }
      return runStripeSetup(ctx, [item]);
    },
  },
  {
    name: "record_artifact",
    description:
      "Record a deliverable for an issue (commit SHA, PR URL, file path, snapshot, or output text). Call this before marking an issue as done so it has an audit trail.",
    inputSchema: z.object({
      issue_id: z.string(),
      kind: z.enum(["file_path", "commit_sha", "pr_url", "snapshot", "output_text"]),
      ref: z.string().min(1).max(1024),
      preview: z.string().max(4096).optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: {
        issue_id: string;
        kind: "file_path" | "commit_sha" | "pr_url" | "snapshot" | "output_text";
        ref: string;
        preview?: string;
      },
      ctx: ToolContext,
    ): Promise<string> => {
      // Defensive length checks — Zod's inputSchema enforces them at the MCP
      // boundary, but unit tests call run() directly and need a runtime guard.
      if (input.ref.length === 0 || input.ref.length > 1024) {
        return JSON.stringify({ ok: false, error: "ref length out of bounds" });
      }
      if (input.preview !== undefined && input.preview.length > 4096) {
        return JSON.stringify({ ok: false, error: "preview length exceeds 4096" });
      }
      const resolvedId = resolveIssueIdOrIdentifier(ctx.db, input.issue_id, ctx.companyId);
      if (resolvedId === null) {
        return JSON.stringify({ ok: false, error: "issue not found" });
      }
      if (input.kind === "commit_sha" && !/^[a-f0-9]{40}$/i.test(input.ref)) {
        return JSON.stringify({ ok: false, error: "commit_sha must be 40-char hex" });
      }
      if (input.kind === "pr_url" && !/^https?:\/\//i.test(input.ref)) {
        return JSON.stringify({ ok: false, error: "pr_url must be http(s)" });
      }
      const repo = createArtifactsRepository(ctx.db);
      const artifact = repo.create({
        issueId: resolvedId,
        kind: input.kind,
        ref: input.ref,
        contentPreview: input.preview ?? null,
        createdBy: ctx.agentId,
      });
      ctx.emit({ kind: "issue.updated", payload: { issueId: resolvedId } });
      return JSON.stringify({ id: artifact.id, issue_id: resolvedId, kind: artifact.kind });
    },
  },
  {
    name: "list_pending_requests",
    description: "List approval requests currently routed to you (the CEO) awaiting a decision.",
    inputSchema: z.object({}),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (_input: unknown, ctx: ToolContext): Promise<string> => {
      const repo = createApprovalsRepository(ctx.db);
      const pending = repo.listPendingRoutedToCeo(ctx.companyId);
      return JSON.stringify({
        pending: pending.map((a) => ({
          approval_id: a.id,
          kind: a.kind,
          requester_agent_id: a.agentId,
          payload: JSON.parse(a.payloadJson) as unknown,
        })),
      });
    },
  },
  {
    name: "decide_request",
    description:
      "Decide an approval request routed to you. decision: approve | reject | escalate. " +
      "For tool permissions this unblocks (or denies) the requesting agent immediately. " +
      "Use escalate to hand the decision to the human operator.",
    inputSchema: z.object({
      approval_id: z.string(),
      decision: z.enum(["approve", "reject", "escalate"]),
      note: z.string().max(2000).optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: { approval_id: string; decision: "approve" | "reject" | "escalate"; note?: string },
      ctx: ToolContext,
    ): Promise<string> => {
      const repo = createApprovalsRepository(ctx.db);
      const apv = repo.getById(input.approval_id);
      if (apv === null) return JSON.stringify({ ok: false, error: "not found" });
      if (apv.status !== "pending" || apv.routedTo !== "ceo") {
        return JSON.stringify({ ok: false, error: "already resolved or not routed to you" });
      }

      // This tool runs in the MCP child where the engine bridge/recorder are
      // null. All decision side-effects (repo.decide for manager_request,
      // trust, delivery, decision card, timer-cancel, escalation, audit) happen
      // in MAIN via handleApprovalEvent. We only do the filesystem write for
      // tool_call here (the requester's request_permission poll reads it
      // directly, and the filesystem is shared across processes).
      if (input.decision === "escalate") {
        ctx.emit({ kind: "approval.escalate", payload: { approvalId: apv.id } });
        return JSON.stringify({ ok: true, escalated: true });
      }

      const note = input.note ?? "";
      // Derived DB status (Exclude<ApprovalStatus,"pending">) used for both kinds.
      const resolvedStatus: "approved" | "rejected" =
        input.decision === "approve" ? "approved" : "rejected";

      if (apv.kind === "tool_call") {
        const payload = JSON.parse(apv.payloadJson) as { tool_use_id: string };
        const file = input.decision === "approve" ? "res.json" : "deny.json";
        const body =
          input.decision === "approve"
            ? { behavior: "allow", decidedBy: ctx.agentId }
            : { behavior: "deny", message: note, decidedBy: ctx.agentId };
        writeFileSync(
          join(ctx.permissionsDir, `${payload.tool_use_id}.${file}`),
          JSON.stringify(body),
        );
        // Mark the row decided immediately so list_pending_requests stops
        // showing this approval as pending. The shared SQLite file is accessible
        // from the MCP child (same process path as MAIN). The requester's
        // request_permission poll will call repo.decide() again after reading
        // the file — that second UPDATE is idempotent and harmless.
        repo.decide(apv.id, resolvedStatus, ctx.agentId, note !== "" ? note : undefined);
        ctx.emit({
          kind: "approval.decided",
          payload: { approvalId: apv.id, decision: input.decision, note, kind: "tool_call" },
        });
        return JSON.stringify({ ok: true, decision: input.decision });
      }

      // manager_request: MAIN decides the row + delivers to the requester.
      ctx.emit({
        kind: "approval.decided",
        payload: { approvalId: apv.id, decision: input.decision, note, kind: "manager_request" },
      });
      return JSON.stringify({ ok: true, decision: input.decision });
    },
  },
  {
    name: "decide_batch",
    description:
      "Decide many approvals in one call. Same semantics as decide_request, " +
      "applied in order. Returns the count decided plus a list of errors for " +
      "approvals that were already resolved or not routed to you. Cheaper in " +
      "tokens than calling decide_request N times when several approvals arrived " +
      "in the same coalescing window.",
    inputSchema: z.object({
      decisions: z
        .array(
          z.object({
            approval_id: z.string(),
            decision: z.enum(["approve", "reject", "escalate"]),
            note: z.string().max(2000).optional(),
          }),
        )
        .min(1)
        .max(50),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: {
        decisions: {
          approval_id: string;
          decision: "approve" | "reject" | "escalate";
          note?: string;
        }[];
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const repo = createApprovalsRepository(ctx.db);
      const errors: { approval_id: string; error: string }[] = [];
      let decided = 0;

      for (const d of input.decisions) {
        const apv = repo.getById(d.approval_id);
        if (apv === null) {
          errors.push({ approval_id: d.approval_id, error: "not found" });
          continue;
        }
        if (apv.status !== "pending" || apv.routedTo !== "ceo") {
          errors.push({
            approval_id: d.approval_id,
            error: "already resolved or not routed to you",
          });
          continue;
        }

        if (d.decision === "escalate") {
          ctx.emit({ kind: "approval.escalate", payload: { approvalId: apv.id } });
          decided++;
          continue;
        }

        const note = d.note ?? "";
        const resolvedStatus: "approved" | "rejected" =
          d.decision === "approve" ? "approved" : "rejected";

        if (apv.kind === "tool_call") {
          const payload = JSON.parse(apv.payloadJson) as { tool_use_id: string };
          const file = d.decision === "approve" ? "res.json" : "deny.json";
          const body =
            d.decision === "approve"
              ? { behavior: "allow", decidedBy: ctx.agentId }
              : { behavior: "deny", message: note, decidedBy: ctx.agentId };
          writeFileSync(
            join(ctx.permissionsDir, `${payload.tool_use_id}.${file}`),
            JSON.stringify(body),
          );
          repo.decide(apv.id, resolvedStatus, ctx.agentId, note !== "" ? note : undefined);
          ctx.emit({
            kind: "approval.decided",
            payload: { approvalId: apv.id, decision: d.decision, note, kind: "tool_call" },
          });
        } else {
          ctx.emit({
            kind: "approval.decided",
            payload: { approvalId: apv.id, decision: d.decision, note, kind: "manager_request" },
          });
        }

        decided++;
      }

      return JSON.stringify({ ok: errors.length === 0, decided, errors });
    },
  },
  {
    name: "request_decision",
    description:
      "Ask your manager (the CEO) to decide something: hiring, budget, unblocking, or an approach. " +
      "Returns immediately as pending; you will be notified with the decision.",
    inputSchema: z.object({
      topic: z.enum(["hire", "fire", "budget", "unblock", "approach", "other"]),
      summary: z.string().min(1).max(2000),
      data: z.record(z.unknown()).optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (
      input: { topic: ManagerTopic; summary: string; data?: Record<string, unknown> },
      ctx: ToolContext,
    ): Promise<string> => {
      const agents = createAgentsRepository(ctx.db, tryGetRecorder());
      const requester = agents.getById(ctx.agentId);
      const requesterIsCeo = requester !== null && isCeoAgent(requester);
      const threadId = createMessagesRepository(ctx.db).ensureThread(ctx.companyId, [
        "user",
        ctx.agentId,
      ]).id;

      // budget topic -> compute whether the requested amount exceeds remaining budget.
      // NOTE: Agent type has budgetUsdLimit (cents) but no budgetSpentCents field on
      // the record itself (spent is derived from cost_events). Since we cannot compute
      // remaining budget without a separate query here, budgetOverLimit defaults to
      // false. The routing logic will still route to CEO as the normal path.
      let budgetOverLimit = false;
      if (input.topic === "budget" && requester !== null) {
        const amount =
          typeof input.data?.["amount_cents"] === "number" ? input.data["amount_cents"] : 0;
        // budgetUsdLimit is the per-agent USD limit in cents; no spent counter on Agent.
        // Treat null limit as infinite -> budgetOverLimit remains false.
        if (requester.budgetUsdLimit !== null) {
          // We don't have spentCents on the Agent record; treat spent as 0 (conservative).
          budgetOverLimit = amount > requester.budgetUsdLimit;
        }
      }

      const approvals = createApprovalsRepository(ctx.db);
      const approval = approvals.create({
        agentId: ctx.agentId,
        kind: "manager_request",
        payload: {
          topic: input.topic,
          summary: input.summary,
          thread_id: threadId,
          ...(input.data !== undefined ? { data: input.data } : {}),
        },
      });
      // This tool runs in the MCP child where the engine bridge is null —
      // routing (CEO wake / human card), the manager_request.created activity,
      // and timer-arming all happen in MAIN via handleApprovalEvent.
      ctx.emit({
        kind: "approval.route",
        payload: {
          approvalId: approval.id,
          requesterIsCeo,
          requesterName: requester?.name ?? "Agente",
          summary: input.summary,
          managerTopic: input.topic,
          budgetOverLimit,
        },
      });
      return JSON.stringify({ status: "pending", approval_id: approval.id });
    },
  },
] as const;
