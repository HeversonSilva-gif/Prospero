import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CLAUDE_MODEL,
  type Agent,
  type AgentMode,
  type AgentStatus,
  type Actor,
} from "@dashboard-agent/shared";
import type { Recorder } from "../activity/recorder.js";

type Row = {
  id: string;
  company_id: string;
  name: string;
  role: string;
  template_id: string | null;
  system_prompt: string;
  skills_json: string;
  allowed_projects_json: string;
  mode: string;
  always_on: number;
  reports_to: string | null;
  claude_session_id: string | null;
  status: string;
  current_action: string | null;
  model: string;
  adapter_name: string;
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
  skills: JSON.parse(r.skills_json) as string[],
  templateId: r.template_id,
  reportsTo: r.reports_to,
  adapterName: r.adapter_name,
});

export type CreateAgentInput = {
  companyId: string;
  name: string;
  role: string;
  systemPrompt: string;
  mode: AgentMode;
  alwaysOn: boolean;
  model?: string;
  skills?: string[];
  templateId?: string | null;
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
  setAllowedProjects(id: string, projectIds: string[]): void;
  setModel(id: string, model: string): void;
  setSystemPrompt(id: string, systemPrompt: string): void;
  setRole(id: string, roleTemplateId: string, opts?: { preserveModel?: boolean }): void;
  setReportsTo(id: string, newParentId: string | null): void;
};

// `recorder` is optional so existing test setups (`createAgentsRepository(db)`)
// keep working without modification. Production wires it via getRecorder().
// When omitted, dual-write to activity_events is silently skipped.
export const createAgentsRepository = (
  db: Database.Database,
  recorder?: Recorder,
): AgentsRepository => {
  const insert = db.prepare(`
    INSERT INTO agents (id, company_id, name, role, system_prompt, skills_json, allowed_projects_json, mode, always_on, status, current_action, model, template_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, 'idle', NULL, ?, ?, ?, ?)
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

  return {
    create(input) {
      const id = `agent_${randomUUID()}`;
      const now = Date.now();
      const finalModel = input.model || DEFAULT_CLAUDE_MODEL;
      insert.run(
        id,
        input.companyId,
        input.name,
        input.role,
        input.systemPrompt,
        JSON.stringify(input.skills ?? []),
        input.mode,
        input.alwaysOn ? 1 : 0,
        finalModel,
        input.templateId ?? null,
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
    setRole(id, roleTemplateId, opts) {
      const role = db
        .prepare("SELECT default_skills_json, default_model FROM role_templates WHERE id = ?")
        .get(roleTemplateId) as { default_skills_json: string; default_model: string } | undefined;
      if (role === undefined) throw new Error(`Role template not found: ${roleTemplateId}`);
      const previous = byId.get(id) as Row | undefined;
      const now = Date.now();
      const txn = db.transaction(() => {
        if (opts?.preserveModel === true) {
          db.prepare(
            "UPDATE agents SET template_id = ?, skills_json = ?, updated_at = ? WHERE id = ?",
          ).run(roleTemplateId, role.default_skills_json, now, id);
        } else {
          db.prepare(
            "UPDATE agents SET template_id = ?, skills_json = ?, model = ?, updated_at = ? WHERE id = ?",
          ).run(roleTemplateId, role.default_skills_json, role.default_model, now, id);
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
