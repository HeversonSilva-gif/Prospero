import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Skill, SkillLifecycleState, SkillSource } from "@prospero/shared";

type SkillRow = {
  id: string;
  company_id: string;
  agent_id: string | null;
  name: string;
  body_path: string;
  description: string;
  version: number;
  applies_to_role: string | null;
  source: string;
  trust: number;
  use_count: number;
  last_used: number | null;
  promoted: number;
  created_at: number;
  soft_deleted: number;
  soft_deleted_at: number | null;
  lifecycle_state: string;
  view_count: number;
  patch_count: number;
  lifecycle_changed_at: number | null;
};

const rowToSkill = (r: SkillRow): Skill => ({
  id: r.id,
  companyId: r.company_id,
  agentId: r.agent_id,
  name: r.name,
  bodyPath: r.body_path,
  description: r.description,
  version: r.version,
  appliesToRole: r.applies_to_role,
  source: r.source as SkillSource,
  trust: r.trust,
  useCount: r.use_count,
  lastUsed: r.last_used,
  promoted: r.promoted === 1,
  createdAt: r.created_at,
  softDeleted: r.soft_deleted === 1,
  lifecycleState: r.lifecycle_state as Skill["lifecycleState"],
  viewCount: r.view_count,
  patchCount: r.patch_count,
  lifecycleChangedAt: r.lifecycle_changed_at,
});

export type CreateSkillInput = {
  companyId: string;
  agentId?: string | null;
  name: string;
  bodyPath: string;
  description: string;
  source: SkillSource;
  appliesToRole?: string | null;
  trust?: number;
};

export type UpdateSkillPatch = {
  bodyPath?: string;
  description?: string;
  trust?: number;
  promoted?: boolean;
};

export type SkillsRepository = {
  create(input: CreateSkillInput): Skill;
  getById(id: string): Skill | null;
  getByName(companyId: string, agentId: string | null, name: string): Skill | null;
  listByAgent(agentId: string): Skill[];
  listCompanyShared(companyId: string): Skill[];
  listForRole(companyId: string, role: string): Skill[];
  listCompanyGlobal(companyId: string): Skill[];
  promote(id: string, appliesToRole: string | null): Skill;
  update(id: string, patch: UpdateSkillPatch): Skill;
  recordUse(id: string): void;
  // M11 PR-F2: `now` (default Date.now()) is stored as soft_deleted_at so the
  // maintenance pass can hard-purge the row after a 30-day grace period.
  softDelete(id: string, now?: number): void;
  // M11 PR-F1: atomically add `delta` to trust, clamped to [0, 1].
  bumpTrust(id: string, delta: number): Skill;
  // Curator: increment view_count for a batch of skill ids (wrapped in a transaction).
  recordView(ids: string[]): void;
  // Curator: increment patch_count for a single skill.
  recordPatch(id: string): void;
  // Curator: set lifecycle_state + lifecycle_changed_at.
  setLifecycleState(id: string, state: SkillLifecycleState, now: number): void;
};

export const createSkillsRepository = (db: Database.Database): SkillsRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO skills (
      id, company_id, agent_id, name, body_path, description, version,
      applies_to_role, source, trust, use_count, last_used, promoted,
      created_at, soft_deleted
    ) VALUES (
      @id, @companyId, @agentId, @name, @bodyPath, @description, 1,
      @appliesToRole, @source, @trust, 0, NULL, 0, @createdAt, 0
    )
  `);
  const byId = db.prepare("SELECT * FROM skills WHERE id = ?");
  const byName = db.prepare(
    "SELECT * FROM skills WHERE company_id = ? AND IFNULL(agent_id,'') = ? AND name = ? AND soft_deleted = 0",
  );
  const byAgent = db.prepare(
    "SELECT * FROM skills WHERE agent_id = ? AND soft_deleted = 0 AND lifecycle_state != 'archived' ORDER BY use_count DESC, created_at DESC",
  );
  const companyShared = db.prepare(
    "SELECT * FROM skills WHERE company_id = ? AND agent_id IS NULL AND soft_deleted = 0 AND lifecycle_state != 'archived' ORDER BY use_count DESC, created_at DESC",
  );
  const forRole = db.prepare(
    "SELECT * FROM skills WHERE company_id = ? AND agent_id IS NULL AND applies_to_role = ? AND soft_deleted = 0 AND lifecycle_state != 'archived' ORDER BY use_count DESC, created_at DESC",
  );
  const companyGlobal = db.prepare(
    "SELECT * FROM skills WHERE company_id = ? AND agent_id IS NULL AND applies_to_role IS NULL AND soft_deleted = 0 AND lifecycle_state != 'archived' ORDER BY use_count DESC, created_at DESC",
  );
  const promoteStmt = db.prepare(
    "UPDATE skills SET agent_id = NULL, promoted = 1, applies_to_role = ? WHERE id = ?",
  );
  const updateStmt = db.prepare(
    "UPDATE skills SET body_path = ?, description = ?, trust = ?, promoted = ?, version = version + 1 WHERE id = ?",
  );
  const recordUseStmt = db.prepare(
    "UPDATE skills SET use_count = use_count + 1, last_used = ?, lifecycle_state = 'active' WHERE id = ?",
  );
  const softDeleteStmt = db.prepare(
    "UPDATE skills SET soft_deleted = 1, soft_deleted_at = ? WHERE id = ?",
  );
  const bumpTrustStmt = db.prepare(
    "UPDATE skills SET trust = MAX(0, MIN(1, trust + ?)) WHERE id = ?",
  );
  const recordViewStmt = db.prepare("UPDATE skills SET view_count = view_count + 1 WHERE id = ?");
  const recordPatchStmt = db.prepare(
    "UPDATE skills SET patch_count = patch_count + 1 WHERE id = ?",
  );
  const setLifecycleStateStmt = db.prepare(
    "UPDATE skills SET lifecycle_state = ?, lifecycle_changed_at = ? WHERE id = ?",
  );

  const getById = (id: string): Skill | null => {
    const row = byId.get(id) as SkillRow | undefined;
    return row === undefined ? null : rowToSkill(row);
  };

  return {
    create(input) {
      const id = `skill_${randomUUID()}`;
      insertStmt.run({
        id,
        companyId: input.companyId,
        agentId: input.agentId ?? null,
        name: input.name,
        bodyPath: input.bodyPath,
        description: input.description,
        appliesToRole: input.appliesToRole ?? null,
        source: input.source,
        trust: input.trust ?? 0.5,
        createdAt: Date.now(),
      });
      return getById(id)!;
    },
    getById,
    getByName(companyId, agentId, name) {
      const row = byName.get(companyId, agentId ?? "", name) as SkillRow | undefined;
      return row === undefined ? null : rowToSkill(row);
    },
    listByAgent(agentId) {
      return (byAgent.all(agentId) as SkillRow[]).map(rowToSkill);
    },
    listCompanyShared(companyId) {
      return (companyShared.all(companyId) as SkillRow[]).map(rowToSkill);
    },
    listForRole(companyId, role) {
      return (forRole.all(companyId, role) as SkillRow[]).map(rowToSkill);
    },
    listCompanyGlobal(companyId) {
      return (companyGlobal.all(companyId) as SkillRow[]).map(rowToSkill);
    },
    promote(id, appliesToRole) {
      if ((byId.get(id) as SkillRow | undefined) === undefined) {
        throw new Error(`skill not found: ${id}`);
      }
      promoteStmt.run(appliesToRole, id);
      return getById(id)!;
    },
    update(id, patch) {
      const existing = byId.get(id) as SkillRow | undefined;
      if (existing === undefined) throw new Error(`skill not found: ${id}`);
      updateStmt.run(
        patch.bodyPath ?? existing.body_path,
        patch.description ?? existing.description,
        patch.trust ?? existing.trust,
        patch.promoted === undefined ? existing.promoted : patch.promoted ? 1 : 0,
        id,
      );
      return getById(id)!;
    },
    recordUse(id) {
      recordUseStmt.run(Date.now(), id);
    },
    softDelete(id, now = Date.now()) {
      softDeleteStmt.run(now, id);
    },
    bumpTrust(id, delta) {
      bumpTrustStmt.run(delta, id);
      const updated = getById(id);
      if (updated === null) throw new Error(`skill not found: ${id}`);
      return updated;
    },
    recordView(ids) {
      const tx = db.transaction((skillIds: string[]) => {
        for (const id of skillIds) {
          recordViewStmt.run(id);
        }
      });
      tx(ids);
    },
    recordPatch(id) {
      recordPatchStmt.run(id);
    },
    setLifecycleState(id, state, now) {
      setLifecycleStateStmt.run(state, now, id);
    },
  };
};
