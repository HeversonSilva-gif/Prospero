import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Memory, MemoryKind } from "@prospero/shared";

type MemoryRow = {
  id: string;
  company_id: string;
  agent_id: string | null;
  applies_to_role: string | null;
  kind: string;
  body: string;
  importance: number;
  trust: number;
  source_event_id: string | null;
  pinned: number;
  created_at: number;
  last_accessed: number | null;
  access_count: number;
  soft_deleted: number;
};

const rowToMemory = (r: MemoryRow): Memory => ({
  id: r.id,
  companyId: r.company_id,
  agentId: r.agent_id,
  appliesToRole: r.applies_to_role,
  kind: r.kind as MemoryKind,
  body: r.body,
  importance: r.importance,
  trust: r.trust,
  sourceEventId: r.source_event_id,
  pinned: r.pinned === 1,
  createdAt: r.created_at,
  lastAccessed: r.last_accessed,
  accessCount: r.access_count,
  softDeleted: r.soft_deleted === 1,
});

export type CreateMemoryInput = {
  companyId: string;
  agentId?: string | null;
  appliesToRole?: string | null;
  kind: MemoryKind;
  body: string;
  importance?: number;
  trust?: number;
  sourceEventId?: string | null;
  pinned?: boolean;
};

export type UpdateMemoryPatch = {
  body?: string;
  importance?: number;
  trust?: number;
  pinned?: boolean;
};

export type MemorySearchOptions = {
  companyId?: string;
  agentId?: string;
  limit?: number;
};

export type MemoriesRepository = {
  create(input: CreateMemoryInput): Memory;
  getById(id: string): Memory | null;
  listByAgent(agentId: string): Memory[];
  listCompanyWide(companyId: string): Memory[];
  listForRole(companyId: string, role: string): Memory[];
  listCompanyGlobal(companyId: string): Memory[];
  update(id: string, patch: UpdateMemoryPatch): Memory;
  softDelete(id: string): void;
  search(query: string, opts?: MemorySearchOptions): Memory[];
  // M11 PR-F1: active, non-pinned, non-identity memories — the decay pass input.
  listDecayCandidates(): Memory[];
  // M11 PR-F1: atomically add `delta` to trust, clamped to [0, 1].
  bumpTrust(id: string, delta: number): Memory;
};

export const createMemoriesRepository = (db: Database.Database): MemoriesRepository => {
  const insertStmt = db.prepare(`
    INSERT INTO memories (
      id, company_id, agent_id, applies_to_role, kind, body, importance, trust,
      source_event_id, pinned, created_at, last_accessed, access_count, soft_deleted
    ) VALUES (
      @id, @companyId, @agentId, @appliesToRole, @kind, @body, @importance, @trust,
      @sourceEventId, @pinned, @createdAt, NULL, 0, 0
    )
  `);
  const insertFts = db.prepare("INSERT INTO memories_fts (memory_id, body) VALUES (?, ?)");
  const updateFts = db.prepare("UPDATE memories_fts SET body = ? WHERE memory_id = ?");
  const byId = db.prepare("SELECT * FROM memories WHERE id = ?");
  const byAgent = db.prepare(
    "SELECT * FROM memories WHERE agent_id = ? AND soft_deleted = 0 ORDER BY importance DESC, created_at DESC",
  );
  const companyWide = db.prepare(
    "SELECT * FROM memories WHERE company_id = ? AND agent_id IS NULL AND soft_deleted = 0 ORDER BY importance DESC, created_at DESC",
  );
  const forRole = db.prepare(
    "SELECT * FROM memories WHERE company_id = ? AND agent_id IS NULL AND applies_to_role = ? AND soft_deleted = 0 ORDER BY importance DESC, created_at DESC",
  );
  const companyGlobal = db.prepare(
    "SELECT * FROM memories WHERE company_id = ? AND agent_id IS NULL AND applies_to_role IS NULL AND soft_deleted = 0 ORDER BY importance DESC, created_at DESC",
  );
  const updateStmt = db.prepare(
    "UPDATE memories SET body = ?, importance = ?, trust = ?, pinned = ? WHERE id = ?",
  );
  const softDeleteStmt = db.prepare("UPDATE memories SET soft_deleted = 1 WHERE id = ?");
  const listDecayCandidatesStmt = db.prepare(
    `SELECT * FROM memories
      WHERE soft_deleted = 0 AND pinned = 0 AND kind != 'identity'
      ORDER BY created_at ASC`,
  );
  const bumpTrustStmt = db.prepare(
    "UPDATE memories SET trust = MAX(0, MIN(1, trust + ?)) WHERE id = ?",
  );

  const getById = (id: string): Memory | null => {
    const row = byId.get(id) as MemoryRow | undefined;
    return row === undefined ? null : rowToMemory(row);
  };

  return {
    create(input) {
      const id = `mem_${randomUUID()}`;
      const params = {
        id,
        companyId: input.companyId,
        agentId: input.agentId ?? null,
        appliesToRole: input.appliesToRole ?? null,
        kind: input.kind,
        body: input.body,
        importance: input.importance ?? 0.5,
        trust: input.trust ?? 0.5,
        sourceEventId: input.sourceEventId ?? null,
        pinned: input.pinned === true ? 1 : 0,
        createdAt: Date.now(),
      };
      const tx = db.transaction(() => {
        insertStmt.run(params);
        insertFts.run(id, input.body);
      });
      tx();
      return getById(id)!;
    },
    getById,
    listByAgent(agentId) {
      return (byAgent.all(agentId) as MemoryRow[]).map(rowToMemory);
    },
    listCompanyWide(companyId) {
      return (companyWide.all(companyId) as MemoryRow[]).map(rowToMemory);
    },
    listForRole(companyId, role) {
      return (forRole.all(companyId, role) as MemoryRow[]).map(rowToMemory);
    },
    listCompanyGlobal(companyId) {
      return (companyGlobal.all(companyId) as MemoryRow[]).map(rowToMemory);
    },
    update(id, patch) {
      const existing = byId.get(id) as MemoryRow | undefined;
      if (existing === undefined) throw new Error(`memory not found: ${id}`);
      const body = patch.body ?? existing.body;
      const importance = patch.importance ?? existing.importance;
      const trust = patch.trust ?? existing.trust;
      const pinned = patch.pinned === undefined ? existing.pinned : patch.pinned ? 1 : 0;
      const tx = db.transaction(() => {
        updateStmt.run(body, importance, trust, pinned, id);
        if (patch.body !== undefined) updateFts.run(patch.body, id);
      });
      tx();
      return getById(id)!;
    },
    softDelete(id) {
      softDeleteStmt.run(id);
    },
    listDecayCandidates() {
      return (listDecayCandidatesStmt.all() as MemoryRow[]).map(rowToMemory);
    },
    bumpTrust(id, delta) {
      bumpTrustStmt.run(delta, id);
      const updated = getById(id);
      if (updated === null) throw new Error(`memory ${id} not found`);
      return updated;
    },
    search(query, opts = {}) {
      const limit = opts.limit ?? 50;
      const clauses = ["memories_fts MATCH ?", "m.soft_deleted = 0"];
      const params: unknown[] = [query];
      if (opts.companyId !== undefined) {
        clauses.push("m.company_id = ?");
        params.push(opts.companyId);
      }
      if (opts.agentId !== undefined) {
        clauses.push("m.agent_id = ?");
        params.push(opts.agentId);
      }
      params.push(limit);
      const rows = db
        .prepare(
          `SELECT m.* FROM memories_fts f
             JOIN memories m ON m.id = f.memory_id
            WHERE ${clauses.join(" AND ")}
            ORDER BY rank
            LIMIT ?`,
        )
        .all(...params) as MemoryRow[];
      return rows.map(rowToMemory);
    },
  };
};
