import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CLAUDE_MODEL,
  type Agent,
  type AgentMode,
  type AgentStatus,
  type Actor,
  type BudgetPeriod,
  type TrustTier,
} from "@prospero/shared";
import type { Recorder } from "../activity/recorder.js";
import { broadcastAgentEvent } from "../ipc/agent-event-broadcast.js";

type Row = {
  id: string;
  company_id: string;
  name: string;
  role: string;
  template_id: string | null;
  system_prompt: string;
  capabilities_json: string;
  allowed_projects_json: string;
  mode: string;
  always_on: number;
  reports_to: string | null;
  claude_session_id: string | null;
  pending_seed: string | null;
  status: string;
  current_action: string | null;
  model: string;
  adapter_name: string;
  paused_at: number | null;
  terminated_at: number | null;
  pause_reason: string | null;
  budget_tokens_limit: number | null;
  budget_usd_limit: number | null;
  budget_period: string;
  budget_warned_period: string | null;
  can_hire: number;
  can_assign: number;
  trust_tier: string;
  auto_mode_set_at: number | null;
  created_at: number;
  updated_at: number;
};

const rowToAgent = (r: Row): Agent => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  role: r.role,
  systemPrompt: r.system_prompt,
  mode: r.mode as AgentMode,
  alwaysOn: r.always_on === 1,
  status: r.status as AgentStatus,
  claudeSessionId: r.claude_session_id,
  currentAction: r.current_action,
  allowedProjects: JSON.parse(r.allowed_projects_json) as string[],
  model: r.model,
  capabilities: JSON.parse(r.capabilities_json) as string[],
  templateId: r.template_id,
  reportsTo: r.reports_to,
  adapterName: r.adapter_name,
  pausedAt: r.paused_at,
  terminatedAt: r.terminated_at,
  pauseReason: r.pause_reason,
  budgetTokensLimit: r.budget_tokens_limit,
  budgetUsdLimit: r.budget_usd_limit,
  budgetPeriod: r.budget_period as BudgetPeriod,
  canHire: r.can_hire === 1,
  canAssign: r.can_assign === 1,
  trustTier: r.trust_tier as TrustTier,
  autoModeSetAt: r.auto_mode_set_at,
  updatedAt: r.updated_at,
});

// Internal enforcement view of an agent's budget — includes budget_warned_period,
// which is NOT part of the public Agent type.
export type AgentBudgetState = {
  tokensLimit: number | null;
  usdLimit: number | null;
  period: BudgetPeriod;
  warnedPeriod: string | null;
  adapterName: string;
};

export type CreateAgentInput = {
  companyId: string;
  name: string;
  role: string;
  systemPrompt: string;
  mode: AgentMode;
  alwaysOn: boolean;
  model?: string;
  capabilities?: string[];
  templateId?: string | null;
  adapterName?: string;
  // Activity actor for the resulting agent.hired event. Defaults to { kind: 'user' }
  // (UI path). MCP tool callers pass { kind: 'agent', id: callerAgentId }.
  actor?: Actor;
};

export type AgentsRepository = {
  create(input: CreateAgentInput): Agent;
  getById(id: string): Agent | null;
  listByCompany(companyId: string): Agent[];
  updateStatus(id: string, patch: { status: AgentStatus; currentAction: string | null }): void;
  setSessionId(id: string, sessionId: string): void;
  clearSessionId(id: string): void;
  /** Durable copy of the router's parked compaction seed so it survives a restart
   *  (audit I8). Written when parked, null when consumed, re-armed at spawn. */
  getPendingSeed(id: string): string | null;
  setPendingSeed(id: string, seed: string | null): void;
  setAllowedProjects(id: string, projectIds: string[]): void;
  setModel(id: string, model: string): void;
  setAdapterName(id: string, adapterName: string): void;
  setSystemPrompt(id: string, systemPrompt: string): void;
  setRole(id: string, roleTemplateId: string, opts?: { preserveModel?: boolean }): void;
  setReportsTo(id: string, newParentId: string | null): void;
  setMode(id: string, mode: AgentMode): void;
  setTrustTier(id: string, tier: TrustTier): void;
  setAlwaysOn(id: string, alwaysOn: boolean): void;
  setCapabilities(id: string, capabilities: string[]): void;
  setBudget(
    id: string,
    input: { tokensLimit: number | null; usdLimit: number | null; period: BudgetPeriod },
  ): void;
  setBudgetWarnedPeriod(id: string, periodKey: string): void;
  setPermissions(id: string, input: { canHire: boolean; canAssign: boolean }): void;
  getBudgetState(id: string): AgentBudgetState | null;
  pause(id: string, reason?: string): void;
  resume(id: string): void;
  listByPauseReason(reason: string): Agent[];
  terminate(id: string, reason?: string): void;
  /**
   * Returns all non-terminated agents in 'auto' mode whose auto_mode_set_at
   * is at least `expiryMs` milliseconds before `now`.
   * Used by the auto-mode expiry checker.
   */
  listExpiredAutoAgents(now: number, expiryMs: number): Agent[];
  /** Boot recovery: reset agents stuck in a transient/error state (no live
   *  process after a restart) back to idle. Leaves paused & terminated agents
   *  alone and preserves session ids. Returns the number reset. */
  resetStuckAgents(): number;
  /** Boot heal: a terminated agent (terminated_at set) whose status drifted away
   *  from 'terminated' (the pre-fix resume bug) is a "zombie" — it still shows in
   *  the status-filtered roster and accepts messages. Force status back to
   *  'terminated' so the existing filters hide it. Idempotent. Returns count. */
  healTerminatedStatus(): number;
  /** Runtime auto-heal: ids of non-terminated agents currently in 'error'. Lets
   *  the scheduler re-enable a stuck agent WITHOUT an app restart (boot-heal only
   *  runs at startup). Used with a per-agent retry cap to avoid respawn storms. */
  listErroredAgentIds(): string[];
};

// `recorder` is optional so existing test setups (`createAgentsRepository(db)`)
// keep working without modification. Production wires it via getRecorder().
// When omitted, dual-write to activity_events is silently skipped.
export const createAgentsRepository = (
  db: Database.Database,
  recorder?: Recorder,
): AgentsRepository => {
  const insert = db.prepare(`
    INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, current_action, model, template_id, adapter_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, 'idle', NULL, ?, ?, ?, ?, ?)
  `);
  const byId = db.prepare("SELECT * FROM agents WHERE id = ?");
  const byCompany = db.prepare("SELECT * FROM agents WHERE company_id = ? ORDER BY created_at ASC");
  const updateStatusStmt = db.prepare(
    "UPDATE agents SET status = ?, current_action = ?, updated_at = ? WHERE id = ?",
  );
  const setSessionStmt = db.prepare(
    "UPDATE agents SET claude_session_id = ?, updated_at = ? WHERE id = ?",
  );
  const clearSessionStmt = db.prepare(
    "UPDATE agents SET claude_session_id = NULL, updated_at = ? WHERE id = ?",
  );
  const getPendingSeedStmt = db.prepare("SELECT pending_seed FROM agents WHERE id = ?");
  const setPendingSeedStmt = db.prepare(
    "UPDATE agents SET pending_seed = ?, updated_at = ? WHERE id = ?",
  );

  return {
    create(input) {
      const id = `agent_${randomUUID()}`;
      const now = Date.now();
      const finalModel = input.model || DEFAULT_CLAUDE_MODEL;
      const adapterName = input.adapterName ?? "claude-oauth-local";
      insert.run(
        id,
        input.companyId,
        input.name,
        input.role,
        input.systemPrompt,
        JSON.stringify(input.capabilities ?? []),
        input.mode,
        input.alwaysOn ? 1 : 0,
        finalModel,
        input.templateId ?? null,
        adapterName,
        now,
        now,
      );
      recorder?.recordActivity({
        companyId: input.companyId,
        actor: input.actor ?? { kind: "user" },
        action: "agent.hired",
        entityKind: "agent",
        entityId: id,
        agentId: id,
        payload: { name: input.name, role: input.role, model: finalModel },
      });
      const row = byId.get(id) as Row;
      return rowToAgent(row);
    },
    getById(id) {
      const row = byId.get(id) as Row | undefined;
      return row ? rowToAgent(row) : null;
    },
    listByCompany(companyId) {
      const rows = byCompany.all(companyId) as Row[];
      return rows.map(rowToAgent);
    },
    updateStatus(id, patch) {
      updateStatusStmt.run(patch.status, patch.currentAction, Date.now(), id);
    },
    setSessionId(id, sessionId) {
      setSessionStmt.run(sessionId, Date.now(), id);
    },
    clearSessionId(id) {
      clearSessionStmt.run(Date.now(), id);
    },
    getPendingSeed(id) {
      const row = getPendingSeedStmt.get(id) as { pending_seed: string | null } | undefined;
      return row?.pending_seed ?? null;
    },
    setPendingSeed(id, seed) {
      setPendingSeedStmt.run(seed, Date.now(), id);
    },
    setAllowedProjects(id, projectIds) {
      const row = byId.get(id) as Row | undefined;
      db.prepare("UPDATE agents SET allowed_projects_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(projectIds),
        Date.now(),
        id,
      );
      if (row !== undefined) {
        recorder?.recordActivity({
          companyId: row.company_id,
          actor: { kind: "user" },
          action: "agent.allowed_projects_changed",
          entityKind: "agent",
          entityId: id,
          agentId: id,
          payload: { projects: projectIds },
        });
      }
    },
    setModel(id, model) {
      const row = byId.get(id) as Row | undefined;
      db.prepare("UPDATE agents SET model = ?, updated_at = ? WHERE id = ?").run(
        model,
        Date.now(),
        id,
      );
      if (row !== undefined) {
        recorder?.recordActivity({
          companyId: row.company_id,
          actor: { kind: "user" },
          action: "agent.model_changed",
          entityKind: "agent",
          entityId: id,
          agentId: id,
          payload: { from: row.model, to: model },
        });
      }
    },
    setAdapterName(id, adapterName) {
      // Plain column UPDATE — the next spawn reads the new adapter_name
      // (design §7.3). No activity record: that would need a new ActivityAction.
      db.prepare("UPDATE agents SET adapter_name = ?, updated_at = ? WHERE id = ?").run(
        adapterName,
        Date.now(),
        id,
      );
    },
    setSystemPrompt(id, systemPrompt) {
      const row = byId.get(id) as Row | undefined;
      db.prepare("UPDATE agents SET system_prompt = ?, updated_at = ? WHERE id = ?").run(
        systemPrompt,
        Date.now(),
        id,
      );
      if (row !== undefined) {
        recorder?.recordActivity({
          companyId: row.company_id,
          actor: { kind: "user" },
          action: "agent.persona_edited",
          entityKind: "agent",
          entityId: id,
          agentId: id,
          payload: { summary: systemPrompt.slice(0, 200) },
        });
      }
    },
    setReportsTo(id, newParentId) {
      const row = byId.get(id) as Row | undefined;
      const previous = row?.reports_to ?? null;
      if (newParentId === null) {
        db.prepare("UPDATE agents SET reports_to = NULL, updated_at = ? WHERE id = ?").run(
          Date.now(),
          id,
        );
        if (row !== undefined) {
          recorder?.recordActivity({
            companyId: row.company_id,
            actor: { kind: "user" },
            action: "agent.reports_to_changed",
            entityKind: "agent",
            entityId: id,
            agentId: id,
            payload: { from: previous, to: null },
          });
        }
        return;
      }
      if (newParentId === id) throw new Error("Agent cannot report to itself (cycle)");
      // A manager must be in the same company. The FK only checks the id exists
      // (relatorioCodex P1).
      if (row !== undefined) {
        const parentRow = byId.get(newParentId) as Row | undefined;
        if (parentRow !== undefined && parentRow.company_id !== row.company_id) {
          throw new Error("Agent cannot report to a manager in a different company");
        }
      }
      const stmt = db.prepare("SELECT reports_to FROM agents WHERE id = ?");
      let cursor: string | null = newParentId;
      const seen = new Set<string>();
      while (cursor !== null) {
        if (cursor === id) throw new Error(`reports_to would create a cycle through ${id}`);
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const next = stmt.get(cursor) as { reports_to: string | null } | undefined;
        cursor = next?.reports_to ?? null;
      }
      db.prepare("UPDATE agents SET reports_to = ?, updated_at = ? WHERE id = ?").run(
        newParentId,
        Date.now(),
        id,
      );
      if (row !== undefined) {
        recorder?.recordActivity({
          companyId: row.company_id,
          actor: { kind: "user" },
          action: "agent.reports_to_changed",
          entityKind: "agent",
          entityId: id,
          agentId: id,
          payload: { from: previous, to: newParentId },
        });
      }
    },
    setMode(id, mode) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return;
      const now = Date.now();
      // Track when 'auto' was activated so the expiry checker can revert it
      // after 24h. Clear the timestamp when returning to supervised.
      const autoModeSetAt = mode === "auto" ? now : null;
      db.prepare(
        "UPDATE agents SET mode = ?, auto_mode_set_at = ?, updated_at = ? WHERE id = ?",
      ).run(mode, autoModeSetAt, now, id);
      recorder?.recordActivity({
        companyId: row.company_id,
        actor: { kind: "user" },
        action: "agent.mode_changed",
        entityKind: "agent",
        entityId: id,
        agentId: id,
        payload: { from: row.mode, to: mode },
      });
    },
    setTrustTier(id, tier) {
      // M14 PR-A: write-only. Activity events for the tier transition are
      // recorded by the trust engine (`apps/main/src/trust/engine.ts`), not
      // here — the engine knows the from-tier and reason; the repo doesn't.
      db.prepare("UPDATE agents SET trust_tier = ?, updated_at = ? WHERE id = ?").run(
        tier,
        Date.now(),
        id,
      );
      // M14 PR-D: broadcast so renderer badges update live. Defensive try/catch
      // — a broadcast failure must never break the tier write.
      try {
        broadcastAgentEvent({ kind: "trust-tier-changed", agentId: id, tier });
      } catch (err) {
        console.warn("[trust] broadcastAgentEvent failed", err);
      }
    },
    setAlwaysOn(id, alwaysOn) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return;
      db.prepare("UPDATE agents SET always_on = ?, updated_at = ? WHERE id = ?").run(
        alwaysOn ? 1 : 0,
        Date.now(),
        id,
      );
      recorder?.recordActivity({
        companyId: row.company_id,
        actor: { kind: "user" },
        action: "agent.always_on_changed",
        entityKind: "agent",
        entityId: id,
        agentId: id,
        payload: { from: row.always_on === 1, to: alwaysOn },
      });
    },
    setCapabilities(id, capabilities) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return;
      const previous = JSON.parse(row.capabilities_json) as string[];
      const prevSet = new Set(previous);
      const nextSet = new Set(capabilities);
      const added = capabilities.filter((s) => !prevSet.has(s));
      const removed = previous.filter((s) => !nextSet.has(s));
      db.prepare("UPDATE agents SET capabilities_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(capabilities),
        Date.now(),
        id,
      );
      recorder?.recordActivity({
        companyId: row.company_id,
        actor: { kind: "user" },
        action: "agent.capabilities_changed",
        entityKind: "agent",
        entityId: id,
        agentId: id,
        payload: { added, removed },
      });
    },
    setBudget(id, { tokensLimit, usdLimit, period }) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return;
      if (tokensLimit !== null && !(Number.isInteger(tokensLimit) && tokensLimit > 0)) {
        throw new Error("budget_tokens_limit must be a positive integer or null");
      }
      if (usdLimit !== null && !(Number.isInteger(usdLimit) && usdLimit > 0)) {
        throw new Error("budget_usd_limit must be a positive integer or null");
      }
      db.prepare(
        "UPDATE agents SET budget_tokens_limit = ?, budget_usd_limit = ?, budget_period = ?, budget_warned_period = NULL, updated_at = ? WHERE id = ?",
      ).run(tokensLimit, usdLimit, period, Date.now(), id);
    },
    setBudgetWarnedPeriod(id, periodKey) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return;
      // Intentionally omits updated_at — internal enforcement marker, not a
      // user-visible config change.
      db.prepare("UPDATE agents SET budget_warned_period = ? WHERE id = ?").run(periodKey, id);
    },
    setPermissions(id, { canHire, canAssign }) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return;
      db.prepare("UPDATE agents SET can_hire = ?, can_assign = ?, updated_at = ? WHERE id = ?").run(
        canHire ? 1 : 0,
        canAssign ? 1 : 0,
        Date.now(),
        id,
      );
    },
    getBudgetState(id) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return null;
      return {
        tokensLimit: row.budget_tokens_limit,
        usdLimit: row.budget_usd_limit,
        period: row.budget_period as BudgetPeriod,
        warnedPeriod: row.budget_warned_period,
        adapterName: row.adapter_name,
      };
    },
    pause(id, reason) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return;
      const now = Date.now();
      db.prepare(
        "UPDATE agents SET status = 'paused', paused_at = ?, pause_reason = ?, updated_at = ? WHERE id = ?",
      ).run(now, reason ?? null, now, id);
      recorder?.recordActivity({
        companyId: row.company_id,
        actor: { kind: "user" },
        action: "agent.paused",
        entityKind: "agent",
        entityId: id,
        agentId: id,
        payload: reason !== undefined ? { reason } : {},
      });
    },
    resume(id) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return;
      // Never revive a terminated agent. The rate-limit pause/resume cycle used
      // to flip a terminated agent's status back to 'idle' here, creating a
      // "zombie" (terminated_at set but status idle) that still showed in the
      // roster (filtered by status) and silently accepted user messages it could
      // never process (spawn correctly refuses terminated agents).
      if (row.terminated_at !== null) return;
      db.prepare(
        "UPDATE agents SET status = 'idle', paused_at = NULL, pause_reason = NULL, updated_at = ? WHERE id = ?",
      ).run(Date.now(), id);
      recorder?.recordActivity({
        companyId: row.company_id,
        actor: { kind: "user" },
        action: "agent.resumed",
        entityKind: "agent",
        entityId: id,
        agentId: id,
        payload: {},
      });
    },
    listByPauseReason(reason) {
      const rows = db
        .prepare(
          "SELECT * FROM agents WHERE pause_reason = ? AND status = 'paused' AND terminated_at IS NULL",
        )
        .all(reason) as Row[];
      return rows.map(rowToAgent);
    },
    terminate(id, reason) {
      const row = byId.get(id) as Row | undefined;
      if (row === undefined) return;
      const now = Date.now();
      db.prepare(
        "UPDATE agents SET status = 'terminated', terminated_at = ?, updated_at = ? WHERE id = ?",
      ).run(now, now, id);
      recorder?.recordActivity({
        companyId: row.company_id,
        actor: { kind: "user" },
        action: "agent.terminated",
        entityKind: "agent",
        entityId: id,
        agentId: id,
        payload: reason !== undefined ? { reason } : {},
      });
    },
    listExpiredAutoAgents(now, expiryMs) {
      // Returns agents in 'auto' mode whose auto_mode_set_at is older than
      // expiryMs milliseconds. Excludes terminated agents — they are no longer
      // active, so reverting their mode is pointless.
      const cutoff = now - expiryMs;
      const rows = db
        .prepare(
          `SELECT * FROM agents
           WHERE mode = 'auto'
             AND auto_mode_set_at IS NOT NULL
             AND auto_mode_set_at <= ?
             AND status != 'terminated'`,
        )
        .all(cutoff) as Row[];
      return rows.map(rowToAgent);
    },
    resetStuckAgents() {
      const stmt = db.prepare(
        `UPDATE agents
            SET status = 'idle', current_action = NULL, updated_at = ?
          WHERE status IN ('error', 'working', 'thinking', 'waiting')
            AND terminated_at IS NULL`,
      );
      return stmt.run(Date.now()).changes;
    },
    healTerminatedStatus() {
      return db
        .prepare(
          "UPDATE agents SET status = 'terminated', updated_at = ? WHERE terminated_at IS NOT NULL AND status != 'terminated'",
        )
        .run(Date.now()).changes;
    },
    listErroredAgentIds() {
      return (
        db
          .prepare("SELECT id FROM agents WHERE status = 'error' AND terminated_at IS NULL")
          .all() as Array<{ id: string }>
      ).map((r) => r.id);
    },
    setRole(id, roleTemplateId, opts) {
      const role = db
        .prepare("SELECT default_capabilities_json, default_model FROM role_templates WHERE id = ?")
        .get(roleTemplateId) as
        | { default_capabilities_json: string; default_model: string }
        | undefined;
      if (role === undefined) throw new Error(`Role template not found: ${roleTemplateId}`);
      const previous = byId.get(id) as Row | undefined;
      const now = Date.now();
      const txn = db.transaction(() => {
        if (opts?.preserveModel === true) {
          db.prepare(
            "UPDATE agents SET template_id = ?, capabilities_json = ?, updated_at = ? WHERE id = ?",
          ).run(roleTemplateId, role.default_capabilities_json, now, id);
        } else {
          db.prepare(
            "UPDATE agents SET template_id = ?, capabilities_json = ?, model = ?, updated_at = ? WHERE id = ?",
          ).run(roleTemplateId, role.default_capabilities_json, role.default_model, now, id);
        }
      });
      txn();
      if (previous !== undefined) {
        recorder?.recordActivity({
          companyId: previous.company_id,
          actor: { kind: "user" },
          action: "agent.role_changed",
          entityKind: "agent",
          entityId: id,
          agentId: id,
          payload: { from: previous.template_id ?? previous.role, to: roleTemplateId },
        });
      }
    },
  };
};
