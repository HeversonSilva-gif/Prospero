// Read-only repository for activity_events. Append-only: only `query`
// is exposed — inserts happen exclusively via the recorder helper.

import type Database from "better-sqlite3";
import type {
  ActivityAction,
  ActivityEventRow,
  ActivityQueryParams,
  ActorKind,
  EntityKind,
} from "@dashboard-agent/shared";

// Re-export for ergonomic imports inside main code.
export type { ActivityQueryFilters, ActivityQueryParams } from "@dashboard-agent/shared";

export interface ActivityRepository {
  query(params: ActivityQueryParams): ActivityEventRow[];
}

type RawRow = {
  id: string;
  company_id: string;
  actor_kind: ActorKind;
  actor_id: string | null;
  action: ActivityAction;
  entity_kind: EntityKind;
  entity_id: string;
  agent_id: string | null;
  payload_json: string;
  created_at: number;
};

const hydrate = (raw: RawRow): ActivityEventRow => ({
  id: raw.id,
  companyId: raw.company_id,
  actorKind: raw.actor_kind,
  actorId: raw.actor_id,
  action: raw.action,
  entityKind: raw.entity_kind,
  entityId: raw.entity_id,
  agentId: raw.agent_id,
  payload: JSON.parse(raw.payload_json) as Record<string, unknown>,
  createdAt: raw.created_at,
});

export const createActivityRepository = (db: Database.Database): ActivityRepository => {
  const query = (params: ActivityQueryParams): ActivityEventRow[] => {
    const where: string[] = ["company_id = @companyId"];
    const bind: Record<string, unknown> = { companyId: params.companyId };

    const f = params.filters ?? {};
    if (f.actorKind !== undefined) {
      where.push("actor_kind = @actorKind");
      bind.actorKind = f.actorKind;
    }
    if (f.action !== undefined) {
      where.push("action = @action");
      bind.action = f.action;
    }
    if (f.entityKind !== undefined) {
      where.push("entity_kind = @entityKind");
      bind.entityKind = f.entityKind;
    }
    if (f.entityId !== undefined) {
      where.push("entity_id = @entityId");
      bind.entityId = f.entityId;
    }
    if (f.agentId !== undefined) {
      where.push("agent_id = @agentId");
      bind.agentId = f.agentId;
    }
    if (f.sinceMs !== undefined) {
      where.push("created_at >= @sinceMs");
      bind.sinceMs = f.sinceMs;
    }
    if (f.untilMs !== undefined) {
      where.push("created_at <= @untilMs");
      bind.untilMs = f.untilMs;
    }

    if (params.cursor !== undefined) {
      where.push(
        "(created_at < @beforeCreatedAt OR (created_at = @beforeCreatedAt AND id < @beforeId))",
      );
      bind.beforeCreatedAt = params.cursor.beforeCreatedAt;
      bind.beforeId = params.cursor.beforeId;
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    const sql = `SELECT * FROM activity_events
                 WHERE ${where.join(" AND ")}
                 ORDER BY created_at DESC, id DESC
                 LIMIT ${limit}`;
    const rows = db.prepare(sql).all(bind) as RawRow[];
    return rows.map(hydrate);
  };

  return { query };
};
