import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CLAUDE_MODEL,
  type Agent,
  type AgentMode,
  type AgentStatus,
} from "@dashboard-agent/shared";

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
};

export const createAgentsRepository = (db: Database.Database): AgentsRepository => {
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
      insert.run(
        id,
        input.companyId,
        input.name,
        input.role,
        input.systemPrompt,
        JSON.stringify(input.skills ?? []),
        input.mode,
        input.alwaysOn ? 1 : 0,
        input.model || DEFAULT_CLAUDE_MODEL,
        input.templateId ?? null,
        now,
        now,
      );
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
      db.prepare("UPDATE agents SET allowed_projects_json = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(projectIds),
        Date.now(),
        id,
      );
    },
    setModel(id, model) {
      db.prepare("UPDATE agents SET model = ?, updated_at = ? WHERE id = ?").run(
        model,
        Date.now(),
        id,
      );
    },
    setSystemPrompt(id, systemPrompt) {
      db.prepare("UPDATE agents SET system_prompt = ?, updated_at = ? WHERE id = ?").run(
        systemPrompt,
        Date.now(),
        id,
      );
    },
    setRole(id, roleTemplateId, opts) {
      const role = db
        .prepare("SELECT default_skills_json, default_model FROM role_templates WHERE id = ?")
        .get(roleTemplateId) as { default_skills_json: string; default_model: string } | undefined;
      if (role === undefined) throw new Error(`Role template not found: ${roleTemplateId}`);
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
    },
  };
};
