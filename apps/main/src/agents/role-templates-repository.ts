import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { RoleTemplate } from "@prospero/shared";

type Row = {
  id: string;
  name: string;
  description: string;
  default_system_prompt: string;
  default_capabilities_json: string;
  default_model: string;
  icon: string | null;
  is_seed_example: number;
  created_at: number;
  updated_at: number;
};

const rowToRole = (r: Row): RoleTemplate => ({
  id: r.id,
  name: r.name,
  description: r.description,
  defaultSystemPrompt: r.default_system_prompt,
  defaultCapabilities: JSON.parse(r.default_capabilities_json) as string[],
  defaultModel: r.default_model,
  icon: r.icon,
  isSeedExample: r.is_seed_example === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// default_system_prompt is legacy plumbing (seeded onto agents at hire time).
// M12 PR-C replaces it with the charter. Until then we keep it coherent with
// the role's name/description so new hires get a sensible one-liner.
const composeLegacyPrompt = (name: string, description: string): string =>
  `You are the ${name}. ${description}`.trim();

export type CreateRoleInput = {
  name: string;
  description: string;
  icon: string | null;
  defaultModel: string;
  defaultCapabilities: string[];
};

export type UpdateRolePatch = {
  name?: string;
  description?: string;
  icon?: string | null;
  defaultModel?: string;
  defaultCapabilities?: string[];
};

export type RoleTemplatesRepository = {
  listAll(): RoleTemplate[];
  getById(id: string): RoleTemplate | null;
  agentsUsing(id: string): Array<{ id: string; name: string }>;
  create(input: CreateRoleInput): RoleTemplate;
  update(id: string, patch: UpdateRolePatch): RoleTemplate;
  // Throws if any agent still references the role.
  delete(id: string): void;
  clone(id: string): RoleTemplate;
  // Bumps updated_at only — used after a charter edit.
  touch(id: string): void;
};

const COLS =
  "id, name, description, default_system_prompt, default_capabilities_json, default_model, icon, is_seed_example, created_at, updated_at";

export const createRoleTemplatesRepository = (db: Database.Database): RoleTemplatesRepository => {
  const listStmt = db.prepare(`SELECT ${COLS} FROM role_templates ORDER BY id`);
  const byIdStmt = db.prepare(`SELECT ${COLS} FROM role_templates WHERE id = ?`);
  const agentsStmt = db.prepare(
    "SELECT id, name FROM agents WHERE template_id = ? ORDER BY created_at",
  );
  const insertStmt = db.prepare(`
    INSERT INTO role_templates
      (id, name, description, default_system_prompt, default_capabilities_json,
       default_model, icon, is_seed_example, created_at, updated_at)
    VALUES
      (@id, @name, @description, @defaultSystemPrompt, @defaultCapabilitiesJson,
       @defaultModel, @icon, 0, @now, @now)
  `);
  const updateStmt = db.prepare(`
    UPDATE role_templates SET
      name = @name, description = @description, default_system_prompt = @defaultSystemPrompt,
      default_capabilities_json = @defaultCapabilitiesJson, default_model = @defaultModel,
      icon = @icon, updated_at = @now
    WHERE id = @id
  `);
  const deleteStmt = db.prepare("DELETE FROM role_templates WHERE id = ?");
  const touchStmt = db.prepare("UPDATE role_templates SET updated_at = ? WHERE id = ?");

  const getById = (id: string): RoleTemplate | null => {
    const row = byIdStmt.get(id) as Row | undefined;
    return row ? rowToRole(row) : null;
  };

  const agentsUsing = (id: string): Array<{ id: string; name: string }> =>
    agentsStmt.all(id) as Array<{ id: string; name: string }>;

  const create = (input: CreateRoleInput): RoleTemplate => {
    const name = input.name.trim();
    if (name === "") throw new Error("role name is required");
    const id = `role_${randomUUID()}`;
    const now = Date.now();
    const description = input.description.trim();
    insertStmt.run({
      id,
      name,
      description,
      defaultSystemPrompt: composeLegacyPrompt(name, description),
      defaultCapabilitiesJson: JSON.stringify(input.defaultCapabilities),
      defaultModel: input.defaultModel,
      icon: input.icon,
      now,
    });
    return getById(id)!;
  };

  return {
    listAll() {
      return (listStmt.all() as Row[]).map(rowToRole);
    },
    getById,
    agentsUsing,
    create,
    update(id, patch) {
      const existing = byIdStmt.get(id) as Row | undefined;
      if (existing === undefined) throw new Error(`role not found: ${id}`);
      const name = (patch.name ?? existing.name).trim();
      if (name === "") throw new Error("role name is required");
      const description = (patch.description ?? existing.description).trim();
      updateStmt.run({
        id,
        name,
        description,
        defaultSystemPrompt: composeLegacyPrompt(name, description),
        defaultCapabilitiesJson:
          patch.defaultCapabilities === undefined
            ? existing.default_capabilities_json
            : JSON.stringify(patch.defaultCapabilities),
        defaultModel: patch.defaultModel ?? existing.default_model,
        icon: patch.icon === undefined ? existing.icon : patch.icon,
        now: Date.now(),
      });
      return getById(id)!;
    },
    delete(id) {
      const inUse = agentsUsing(id);
      if (inUse.length > 0) {
        throw new Error(`role in use by ${inUse.length} agent(s)`);
      }
      deleteStmt.run(id);
    },
    clone(id) {
      const src = getById(id);
      if (src === null) throw new Error(`role not found: ${id}`);
      return create({
        name: `${src.name} (copy)`,
        description: src.description,
        icon: src.icon,
        defaultModel: src.defaultModel,
        defaultCapabilities: src.defaultCapabilities,
      });
    },
    touch(id) {
      touchStmt.run(Date.now(), id);
    },
  };
};
