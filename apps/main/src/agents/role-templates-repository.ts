import type Database from "better-sqlite3";
import type { RoleTemplate } from "@dashboard-agent/shared";

type Row = {
  id: string;
  name: string;
  description: string;
  default_system_prompt: string;
  default_skills_json: string;
  default_model: string;
  icon: string | null;
};

const rowToRole = (r: Row): RoleTemplate => ({
  id: r.id,
  name: r.name,
  description: r.description,
  defaultSystemPrompt: r.default_system_prompt,
  defaultSkills: JSON.parse(r.default_skills_json) as string[],
  defaultModel: r.default_model,
  icon: r.icon,
});

export type RoleTemplatesRepository = {
  listAll(): RoleTemplate[];
  getById(id: string): RoleTemplate | null;
  agentsUsing(id: string): Array<{ id: string; name: string }>;
};

export const createRoleTemplatesRepository = (db: Database.Database): RoleTemplatesRepository => {
  const listStmt = db.prepare(
    "SELECT id, name, description, default_system_prompt, default_skills_json, default_model, icon FROM role_templates ORDER BY id",
  );
  const byIdStmt = db.prepare(
    "SELECT id, name, description, default_system_prompt, default_skills_json, default_model, icon FROM role_templates WHERE id = ?",
  );
  const agentsStmt = db.prepare(
    "SELECT id, name FROM agents WHERE template_id = ? ORDER BY created_at",
  );

  return {
    listAll() {
      return (listStmt.all() as Row[]).map(rowToRole);
    },
    getById(id) {
      const row = byIdStmt.get(id) as Row | undefined;
      return row ? rowToRole(row) : null;
    },
    agentsUsing(id) {
      return agentsStmt.all(id) as Array<{ id: string; name: string }>;
    },
  };
};
