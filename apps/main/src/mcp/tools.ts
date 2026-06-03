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
import type { CloudflareDeployEventResult } from "../connections/cloudflare-deploy-event.js";
import type { CloudflareD1EventResult } from "../connections/cloudflare-d1-event.js";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { createStripePaymentsRepository } from "../connections/stripe-payments-repository.js";
import { createCostsRepository } from "../costs/repository.js";
import { zoneOf, canAccess } from "../security/zones.js";
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
import { checkActionCap } from "../approvals/action-cap.js";
import { createGuardrailAlert } from "../security/guardrail-alert.js";
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

// Authority guard for the CEO-only approval tools. The MCP child auto-allows
// meta-tools in auto-mode, so the permission gate never sees these calls — a
// worker that knows an approval ID could otherwise approve its own blocked call.
// These tools MUST verify, at the tool boundary, that the caller is the CEO of
// this company (audit 2026-06-03 Facet 4 C2/M7).
const callerIsCeo = (ctx: ToolContext): boolean => {
  const caller = createAgentsRepository(ctx.db).getById(ctx.agentId);
  return caller !== null && caller.companyId === ctx.companyId && isCeoAgent(caller);
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

  // Runaway circuit-breaker: deny (without creating an approval) once the per-hour cap
  // for this side-effecting tool — or the company ceiling — is hit. Read/unknown tools
  // return exceeded:false. Counting attempts that created rows caps how many proceed.
  const cap = checkActionCap(ctx.db, {
    companyId: ctx.companyId,
    agentId: ctx.agentId,
    toolName,
    now: Date.now(),
  });
  if (cap.exceeded) {
    createGuardrailAlert(ctx.db, {
      companyId: ctx.companyId,
      actorId: ctx.agentId,
      title: "Limite de ações por hora atingido",
      preview: `${toolName}: ${cap.count}/${cap.limit} por hora (${cap.scope === "company" ? "teto da empresa" : "limite do agente"})`,
    });
    tryGetRecorder()?.recordActivity({
      companyId: ctx.companyId,
      actor: { kind: "agent", id: ctx.agentId },
      action: "security.action_cap_exceeded",
      entityKind: "agent",
      entityId: ctx.agentId,
      agentId: ctx.agentId,
      payload: { toolName, limit: cap.limit, count: cap.count, scope: cap.scope },
    });
    return {
      decision: "deny",
      message: `Limite de ${cap.limit}/hora atingido para ${toolName}. Tente novamente mais tarde.`,
    };
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

// I3 (Conectores audit): a conservative single-address email check (local@domain.tld,
// no spaces/commas/newlines — newlines also block header injection). Not RFC-complete,
// but it rejects the obviously-bogus / abusive targets the gate prose only described.
const isValidEmailAddress = (raw: string): boolean => {
  const s = raw.trim();
  // Reject all control chars (incl. NUL/C0/DEL) — \s only covers CR/LF/tab, but NUL and
  // other control bytes are header-injection / smuggling vectors too.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(s) && s.length <= 320;
};

// M2 (Conectores audit): a per-hour cap WITHOUT human approval, for side-effecting
// actions that auto-run (e.g. a preview deploy). Production deploys consume a cap slot
// via gateAction; previews skipped the gate entirely and so were unbounded — burning
// Cloudflare build minutes. This counts a slot the same way (a decided approval row) so
// the deploy_app cap spans preview + production. Returns false (with a message) when the
// hourly cap is already hit.
const enforceActionCapOnly = (
  ctx: ToolContext,
  toolName: string,
  toolInput: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } => {
  const cap = checkActionCap(ctx.db, {
    companyId: ctx.companyId,
    agentId: ctx.agentId,
    toolName,
    now: Date.now(),
  });
  if (cap.exceeded) {
    createGuardrailAlert(ctx.db, {
      companyId: ctx.companyId,
      actorId: ctx.agentId,
      title: "Limite de ações por hora atingido",
      preview: `${toolName}: ${cap.count}/${cap.limit} por hora (${cap.scope === "company" ? "teto da empresa" : "limite do agente"})`,
    });
    return {
      ok: false,
      message: `Limite de ${cap.limit}/hora atingido para ${toolName}. Tente novamente mais tarde.`,
    };
  }
  // Consume a slot so the cap actually bounds these auto-run actions.
  try {
    const approvals = createApprovalsRepository(ctx.db);
    const a = approvals.create({
      agentId: ctx.agentId,
      kind: "tool_call",
      payload: { tool_name: toolName, tool_input: toolInput, tool_use_id: randomUUID() },
    });
    approvals.decide(a.id, "approved", "system");
  } catch (err) {
    console.warn("[gate] failed to record auto action-cap slot", err);
  }
  return { ok: true };
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

// Polls for the result the MAIN-process `cloudflare.deploy` handler writes back (keyed by
// requestId) so deploy_app returns the live URL — or a clear error. A deploy can take a
// couple of minutes (build upload), so the timeout is generous. Mirrors waitForXResult.
const waitForDeployResult = async (
  dir: string,
  requestId: string,
  timeoutMs: number,
): Promise<CloudflareDeployEventResult> => {
  const path = join(dir, `${requestId}.deploy.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      const r = JSON.parse(readFileSync(path, "utf8")) as CloudflareDeployEventResult;
      safeUnlink(path);
      return r;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, error: "Tempo esgotado aguardando o deploy no Cloudflare." };
};

// Emits the `cloudflare.deploy` event MAIN reacts to (only MAIN holds the cipher to
// decrypt the company's Cloudflare token), then waits for the result. Called after the
// zone-check (always) and, for production, after gateAction approved.
const runCloudflareDeploy = async (
  ctx: ToolContext,
  input: { project_path: string; project_name: string; mode: "preview" | "production" },
): Promise<string> => {
  const requestId = randomUUID();
  ctx.emit({
    kind: "cloudflare.deploy",
    payload: {
      requestId,
      projectPath: input.project_path,
      projectName: input.project_name,
      mode: input.mode,
    },
  });
  const result = await waitForDeployResult(ctx.permissionsDir, requestId, 5 * 60_000);
  return JSON.stringify(result);
};

// Same round-trip for D1 provisioning (create/migrate), keyed by `${requestId}.d1.json`.
const runCloudflareD1 = async (
  ctx: ToolContext,
  input: { project_path: string; database_name: string; command: "create" | "migrate" },
): Promise<string> => {
  const requestId = randomUUID();
  ctx.emit({
    kind: "cloudflare.d1",
    payload: {
      requestId,
      projectPath: input.project_path,
      databaseName: input.database_name,
      command: input.command,
    },
  });
  const path = join(ctx.permissionsDir, `${requestId}.d1.json`);
  const start = Date.now();
  while (Date.now() - start < 3 * 60_000) {
    if (existsSync(path)) {
      const r = JSON.parse(readFileSync(path, "utf8")) as CloudflareD1EventResult;
      safeUnlink(path);
      return JSON.stringify(r);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return JSON.stringify({ ok: false, error: "Tempo esgotado aguardando o D1 no Cloudflare." });
};

// Polls for the result MAIN's email.send/email.read handler writes back (keyed by
// requestId). The result is opaque JSON the tool passes straight through to the agent.
const waitForEmailResult = async (
  dir: string,
  requestId: string,
  timeoutMs: number,
): Promise<string> => {
  const path = join(dir, `${requestId}.email.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8");
      safeUnlink(path);
      return raw;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return JSON.stringify({ ok: false, error: "Tempo esgotado aguardando o e-mail." });
};

const runEmailSend = async (
  ctx: ToolContext,
  input: { to: string | string[]; subject: string; body: string; in_reply_to?: string },
): Promise<string> => {
  const requestId = randomUUID();
  ctx.emit({
    kind: "email.send",
    payload: {
      requestId,
      to: input.to,
      subject: input.subject,
      body: input.body,
      ...(input.in_reply_to !== undefined ? { inReplyTo: input.in_reply_to } : {}),
    },
  });
  return waitForEmailResult(ctx.permissionsDir, requestId, 60_000);
};

const runEmailRead = async (ctx: ToolContext, limit: number | undefined): Promise<string> => {
  const requestId = randomUUID();
  ctx.emit({
    kind: "email.read",
    payload: { requestId, ...(limit !== undefined ? { limit } : {}) },
  });
  return waitForEmailResult(ctx.permissionsDir, requestId, 30_000);
};

export const toolDefinitions = [
  {
    name: "list_agents",
    description: "List all agents in the current company.",
    inputSchema: z.object({}),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (_input: unknown, ctx: ToolContext): Promise<string> => {
      const repo = createAgentsRepository(ctx.db, tryGetRecorder());
      // Hide terminated agents: `terminatedAt` is the authoritative kill marker
      // (a zombie row may have status reset to idle). The CEO must not see — and
      // therefore cannot reassign work to — a corpse. Audit 2026-06-03 Facet 2 C1.
      const agents = repo.listByCompany(ctx.companyId).filter((a) => a.terminatedAt === null);
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
      // Company scope: only fire agents in the caller's own company — never
      // kill/delete another company's agent. Audit 2026-06-03 Facet 4 C1.
      if (target === undefined || target.company_id !== ctx.companyId) {
        return JSON.stringify({ ok: false, error: "agent not found" });
      }
      ctx.emit({ kind: "agent.kill", payload: { agentId: input.agent_id } });
      ctx.db
        .prepare("DELETE FROM agents WHERE id = ? AND company_id = ?")
        .run(input.agent_id, ctx.companyId);
      tryGetRecorder()?.recordActivity({
        companyId: target.company_id,
        actor: { kind: "agent", id: ctx.agentId },
        action: "agent.terminated",
        entityKind: "agent",
        entityId: input.agent_id,
        agentId: input.agent_id,
        payload: { reason: "fire_agent invoked" },
      });
      return JSON.stringify({ ok: true });
    },
  },
  {
    name: "create_issue",
    description:
      "Create a new issue. project may be a project ID or a project name. Pass goal_id to attach the issue to a goal so completing it advances that goal's verification.",
    inputSchema: z.object({
      project: z.string(),
      title: z.string().min(1),
      description: z.string().optional(),
      assignee: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      parent_id: z.string().optional(),
      goal_id: z.string().optional(),
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
        goal_id?: string;
      },
      ctx: ToolContext,
    ): Promise<string> => {
      const issues = createIssuesRepository(ctx.db, tryGetRecorder());
      const lookup = issues.resolveProjectByNameOrId(ctx.companyId, input.project);
      if (lookup.matches === 0) return JSON.stringify({ ok: false, error: "project not found" });
      if (lookup.matches > 1)
        return JSON.stringify({ ok: false, error: "multiple projects match" });
      // C (audit 2026-06-03): validate the goal belongs to this company before
      // linking. An ad-hoc issue with no goal stays orphaned — its completion
      // can never advance a goal's verification, so the loop never closes for it.
      if (input.goal_id !== undefined) {
        const g = ctx.db.prepare("SELECT company_id FROM goals WHERE id = ?").get(input.goal_id) as
          | { company_id: string }
          | undefined;
        if (g === undefined || g.company_id !== ctx.companyId) {
          return JSON.stringify({ ok: false, error: "goal not found" });
        }
      }
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
      if (input.goal_id !== undefined) {
        ctx.db.prepare("UPDATE issues SET goal_id = ? WHERE id = ?").run(input.goal_id, created.id);
      }
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
      // I-sm (audit 2026-06-03): the agent path enforces the documented issue
      // machine — `done` is only reachable from `doing` or `review`. A
      // backlog/todo -> done jump skips the work, zeroes the tool-history, and
      // fires premature verification. Humans dragging the Kanban board go
      // through the IPC repo path, which keeps full freedom; only agents are
      // bound here.
      if (input.status === "done" && existing.status !== "doing" && existing.status !== "review") {
        return JSON.stringify({
          ok: false,
          error: `cannot move issue to 'done' from '${existing.status}' — move it to 'doing' while you work it, then to 'done' (or 'review'). No jumping straight to done.`,
        });
      }
      // C8 (audit 2026-06-03): only the issue's assignee or the CEO (who
      // approves work in `review`) may close it. Otherwise any company agent
      // could close another's issue — with a falsifiable artifact that is trust
      // laundering (verified work the agent never did).
      if (input.status === "done" && existing.assigneeId !== ctx.agentId && !callerIsCeo(ctx)) {
        return JSON.stringify({
          ok: false,
          error: "only the issue's assignee or the CEO can mark it done",
        });
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
      // C5 (audit 2026-06-03): the MCP child has no recorder, so the repo's
      // recordActivity for this status change is a silent no-op — agent issue
      // work was invisible to the derivation/routines/recall observers. Carry
      // the from/to so MAIN re-records the issue.status_changed activity.
      const statusChanged =
        input.status !== undefined && existing.status !== next.status
          ? { from: existing.status, to: next.status, agentId: ctx.agentId }
          : undefined;
      ctx.emit({
        kind: "issue.updated",
        payload: {
          issueId: next.id,
          ...(statusChanged !== undefined ? { statusChange: statusChanged } : {}),
        },
      });
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
      // `terminated_at IS NULL`: never assign to a terminated agent — the issue
      // would sit in `doing` with nobody working it, and the reconciler would
      // wake the CEO to reassign it to the same corpse (invisible stall loop).
      // Audit 2026-06-03 Facet 2 C1.
      const targetAgent = ctx.db
        .prepare("SELECT id FROM agents WHERE id = ? AND company_id = ? AND terminated_at IS NULL")
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
      // C6 (audit 2026-06-03): wake the new assignee. The MCP child can't call
      // notifyAssignee (no BrowserWindow); MAIN turns this into the wake event.
      // Without it a delegated issue just sat idle (= the dead recall-seed
      // diferido #7 too — the seed is only consumed once the agent is woken).
      ctx.emit({ kind: "issue.assigned", payload: { issueId: next.id } });
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
    name: "stripe_sales_read",
    description:
      "Read a digest of the company's Stripe sales — number of payments, total per currency, and recent payments — from the ingested data. Read-only; use it to know whether the business is actually selling.",
    inputSchema: z.object({ days: z.number().int().positive().max(365).optional() }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: { days?: number }, ctx: ToolContext): Promise<string> => {
      const windowMs = (input.days ?? 30) * 24 * 60 * 60_000;
      const since = Date.now() - windowMs;
      const repo = createStripePaymentsRepository(ctx.db);
      // C3 (Conectores audit): count, currency totals and the recent list are all WINDOWED
      // by `days` — previously the count/totals were lifetime while `recent` was windowed,
      // so the CEO saw "30d, 47 payments, no revenue". Totals are net of refunds (I5).
      const totals = repo.windowTotals(ctx.companyId, since);
      const lifetime = repo.totalsByCompany(ctx.companyId);
      const recent = repo.listByCompany(ctx.companyId, since).slice(0, 20);
      return JSON.stringify({
        windowDays: input.days ?? 30,
        totalPayments: totals.count,
        totalByCurrency: totals.amountByCurrency,
        lifetimePayments: lifetime.count,
        lifetimeByCurrency: lifetime.amountByCurrency,
        recent: recent.map((p) => ({ amount: p.amount, currency: p.currency, at: p.createdAt })),
      });
    },
  },
  {
    name: "deploy_app",
    description:
      "Deploy the web app the team built to the company's connected Cloudflare account (Pages). mode 'preview' publishes an unlisted URL to test on (automatic); mode 'production' publishes the business's public URL and is gated for approval first (auto once trusted). project_path = the built app directory (absolute); project_name = a lowercase DNS-safe slug. Returns the live URL, or a clear error if Cloudflare isn't connected / it was rejected.",
    inputSchema: z.object({
      project_path: z.string().min(1),
      project_name: z
        .string()
        .min(1)
        .max(58)
        .regex(/^[a-z0-9][a-z0-9-]*$/, "use a lowercase dns-safe slug"),
      mode: z.enum(["preview", "production"]),
    }),
    run: async (
      input: { project_path: string; project_name: string; mode: "preview" | "production" },
      ctx: ToolContext,
    ): Promise<string> => {
      // A leading '-' would let the path masquerade as a wrangler flag in argv — reject.
      if (input.project_path.startsWith("-")) {
        return JSON.stringify({ ok: false, error: "Caminho de projeto inválido." });
      }
      // Don't let the agent deploy a system zone (its sandbox holds credentials) or
      // another company's/agent's dir. A null zone = a real user project dir the zone
      // system has no opinion on ⇒ allowed.
      const zone = zoneOf(input.project_path, ctx.userDataDir);
      if (zone !== null && !canAccess({ companyId: ctx.companyId, id: ctx.agentId }, zone)) {
        return JSON.stringify({ ok: false, error: "Caminho fora da área permitida para deploy." });
      }
      if (input.mode === "production") {
        const outcome = await gateAction(
          ctx,
          "deploy_app",
          {
            project_path: input.project_path,
            project_name: input.project_name,
            mode: "production",
          },
          randomUUID(),
        );
        if (outcome.decision !== "allow") {
          return JSON.stringify({ ok: false, status: outcome.decision, message: outcome.message });
        }
      } else {
        // M2: a preview auto-runs (no approval) but still consumes a SEPARATE hourly cap
        // (deploy_app_preview) so it can't loop unbounded — without eating the 1/h
        // production slot, so "preview then promote" still works.
        const capped = enforceActionCapOnly(ctx, "deploy_app_preview", {
          project_name: input.project_name,
          mode: "preview",
        });
        if (!capped.ok) {
          return JSON.stringify({ ok: false, status: "deny", message: capped.message });
        }
      }
      return runCloudflareDeploy(ctx, input);
    },
  },
  {
    name: "deployment_status",
    description:
      "Read the company's last published production URL and whether Cloudflare is connected. Read-only.",
    inputSchema: z.object({}),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (_input: unknown, ctx: ToolContext): Promise<string> => {
      const row = ctx.db
        .prepare(
          "SELECT metadata_json FROM connections WHERE company_id = ? AND kind = 'cloudflare'",
        )
        .get(ctx.companyId) as { metadata_json: string | null } | undefined;
      if (row === undefined) return JSON.stringify({ connected: false });
      const meta =
        row.metadata_json !== null
          ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
          : {};
      const url = typeof meta.lastDeployUrl === "string" ? meta.lastDeployUrl : null;
      return JSON.stringify({ connected: true, productionUrl: url });
    },
  },
  {
    name: "provision_database",
    description:
      "Provision the app's Cloudflare D1 (SQLite) database. command 'create' creates the database and returns its id + the wrangler.toml [[d1_databases]] binding snippet to paste; command 'migrate' applies the project's migrations to the remote database. Gated for approval (infra setup). project_path = the app directory (absolute); database_name = a lowercase DNS-safe slug.",
    inputSchema: z.object({
      project_path: z.string().min(1),
      database_name: z
        .string()
        .min(1)
        .max(58)
        .regex(/^[a-z0-9][a-z0-9-]*$/, "use a lowercase dns-safe slug"),
      command: z.enum(["create", "migrate"]),
    }),
    run: async (
      input: { project_path: string; database_name: string; command: "create" | "migrate" },
      ctx: ToolContext,
    ): Promise<string> => {
      if (input.project_path.startsWith("-")) {
        return JSON.stringify({ ok: false, error: "Caminho de projeto inválido." });
      }
      const zone = zoneOf(input.project_path, ctx.userDataDir);
      if (zone !== null && !canAccess({ companyId: ctx.companyId, id: ctx.agentId }, zone)) {
        return JSON.stringify({ ok: false, error: "Caminho fora da área permitida." });
      }
      const outcome = await gateAction(
        ctx,
        "provision_database",
        { database_name: input.database_name, command: input.command },
        randomUUID(),
      );
      if (outcome.decision !== "allow") {
        return JSON.stringify({ ok: false, status: outcome.decision, message: outcome.message });
      }
      return runCloudflareD1(ctx, input);
    },
  },
  {
    name: "send_email",
    description:
      "Send an email from the company's connected mailbox: deliver a product/access to a buyer after a sale, reply to a customer, or follow up an opted-in lead. Gated for approval first (auto once trusted). `to` is one or a few recipients — there is NO bulk/cold campaign. Pass in_reply_to (a Message-Id) to thread a reply. Returns the message id, or a clear error if email isn't connected / was rejected.",
    inputSchema: z.object({
      to: z.union([z.string().min(3).max(320), z.array(z.string().min(3).max(320)).min(1).max(20)]),
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(20000),
      in_reply_to: z.string().max(998).optional(),
    }),
    run: async (
      input: { to: string | string[]; subject: string; body: string; in_reply_to?: string },
      ctx: ToolContext,
    ): Promise<string> => {
      // I3 (Conectores audit): validate every recipient is a syntactically real address
      // before doing anything (no gate, no send). "Send to opted-in addresses, no bulk"
      // was only prose; this enforces at least that the target is a well-formed mailbox,
      // so the agent can't fire mail at arbitrary garbage / header-injection strings.
      const recipients = Array.isArray(input.to) ? input.to : [input.to];
      const bad = recipients.filter((r) => !isValidEmailAddress(r));
      if (recipients.length === 0 || bad.length > 0) {
        return JSON.stringify({
          ok: false,
          error: `Destinatário inválido: ${bad.join(", ") || "(vazio)"}. Use endereços de e-mail válidos.`,
        });
      }
      const toolInput: Record<string, unknown> = {
        to: input.to,
        subject: input.subject,
        body: input.body,
        ...(input.in_reply_to !== undefined ? { in_reply_to: input.in_reply_to } : {}),
      };
      const outcome = await gateAction(ctx, "send_email", toolInput, randomUUID());
      if (outcome.decision !== "allow") {
        return JSON.stringify({ ok: false, status: outcome.decision, message: outcome.message });
      }
      return runEmailSend(ctx, input);
    },
  },
  {
    name: "read_emails",
    description:
      "Read recent emails received in the company's connected mailbox, so you can see customer messages and reply. Read-only. Available only when email is connected in SMTP/IMAP mode (not Resend).",
    inputSchema: z.object({ limit: z.number().int().positive().max(50).optional() }),
    run: async (input: { limit?: number }, ctx: ToolContext): Promise<string> =>
      runEmailRead(ctx, input.limit),
  },
  {
    name: "finance_read",
    description:
      "Read the company's finances over a window: Claude cost (USD) vs Stripe revenue (per currency) + total payment count. Read-only — use it to know whether the business is profitable before deciding to spend.",
    inputSchema: z.object({ days: z.number().int().positive().max(365).optional() }),
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async (input: { days?: number }, ctx: ToolContext): Promise<string> => {
      const windowDays = input.days ?? 30;
      const since = Date.now() - windowDays * 24 * 60 * 60_000;
      const cost = createCostsRepository(ctx.db).getCompanyTotalSince(ctx.companyId, since);
      const payments = createStripePaymentsRepository(ctx.db);
      // C3 (Conectores audit): revenue AND count are both windowed (and net of refunds —
      // I5). Previously revenueByCurrency was windowed but the count was lifetime, so the
      // "am I profitable?" read was internally inconsistent.
      const windowed = payments.windowTotals(ctx.companyId, since);
      return JSON.stringify({
        windowDays,
        costUsd: cost.cents / 100,
        revenueByCurrency: windowed.amountByCurrency,
        revenueCount: windowed.count,
      });
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
      // C8 (audit 2026-06-03): only the issue's assignee or the CEO may attach a
      // deliverable. Fabricating another agent's artifact is trust laundering.
      const artifactIssue = createIssuesRepository(ctx.db).getById(resolvedId);
      if (artifactIssue !== null && artifactIssue.assigneeId !== ctx.agentId && !callerIsCeo(ctx)) {
        return JSON.stringify({
          ok: false,
          error: "only the issue's assignee or the CEO can record an artifact for it",
        });
      }
      // commit_sha accepts 7..64 hex (short SHA-1 through full SHA-256) — the
      // old 40-only rule rejected short refs and SHA-256 repos. Audit 2026-06-03.
      if (input.kind === "commit_sha" && !/^[a-f0-9]{7,64}$/i.test(input.ref)) {
        return JSON.stringify({ ok: false, error: "commit_sha must be 7-64 hex chars" });
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
      // Only the CEO has requests routed to them; a non-CEO caller must not see
      // (and could otherwise read) other agents' approval payloads. Audit
      // 2026-06-03 Facet 4 M7.
      if (!callerIsCeo(ctx)) {
        return JSON.stringify({ pending: [] });
      }
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
      if (!callerIsCeo(ctx)) {
        return JSON.stringify({ ok: false, error: "only the CEO can decide approvals" });
      }
      const repo = createApprovalsRepository(ctx.db);
      const apv = repo.getById(input.approval_id);
      if (apv === null) return JSON.stringify({ ok: false, error: "not found" });
      if (apv.status !== "pending" || apv.routedTo !== "ceo") {
        return JSON.stringify({ ok: false, error: "already resolved or not routed to you" });
      }
      // Company isolation: the approval's requester must belong to this company,
      // so the CEO of company A cannot decide an approval raised in company B.
      // Skipped when there is no requester id (e.g. a system-raised approval).
      if (apv.agentId !== null) {
        const requester = createAgentsRepository(ctx.db).getById(apv.agentId);
        if (requester === null || requester.companyId !== ctx.companyId) {
          return JSON.stringify({ ok: false, error: "not found" });
        }
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
      if (!callerIsCeo(ctx)) {
        return JSON.stringify({
          ok: false,
          decided: 0,
          errors: input.decisions.map((d) => ({
            approval_id: d.approval_id,
            error: "only the CEO can decide approvals",
          })),
        });
      }
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
        // Company isolation (mirrors decide_request): the approval's requester
        // must belong to this company (skipped when there is no requester id).
        if (apv.agentId !== null) {
          const requester = createAgentsRepository(ctx.db).getById(apv.agentId);
          if (requester === null || requester.companyId !== ctx.companyId) {
            errors.push({ approval_id: d.approval_id, error: "not found" });
            continue;
          }
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
