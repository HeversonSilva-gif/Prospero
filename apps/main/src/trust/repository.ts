import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { TrustEvent, TrustEventKind, TrustTier } from "@prospero/shared";

// M14 PR-A — TrustEventsRepository. Single-table CRUD over trust_events.
// Mirrors the inbox repository idiom. Order by created_at DESC, rowid DESC
// so two events inserted within the same millisecond have a deterministic
// tiebreaker (lesson `project_m13_pr_b1_lessons`).

export type CreateTrustEventInput = {
  agentId: string;
  kind: TrustEventKind;
  fromTier: TrustTier;
  toTier: TrustTier;
  reason: string;
};

export type TrustEventsRepository = {
  create(input: CreateTrustEventInput): TrustEvent;
  listByAgent(agentId: string): TrustEvent[];
};

type TrustEventRow = {
  id: string;
  agent_id: string;
  kind: TrustEventKind;
  from_tier: TrustTier;
  to_tier: TrustTier;
  reason: string;
  created_at: number;
};

const rowToEvent = (r: TrustEventRow): TrustEvent => ({
  id: r.id,
  agentId: r.agent_id,
  kind: r.kind,
  fromTier: r.from_tier,
  toTier: r.to_tier,
  reason: r.reason,
  createdAt: r.created_at,
});

export const createTrustEventsRepository = (db: Database.Database): TrustEventsRepository => {
  const insertStmt = db.prepare(
    `INSERT INTO trust_events
       (id, agent_id, kind, from_tier, to_tier, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const listStmt = db.prepare(
    "SELECT id, agent_id, kind, from_tier, to_tier, reason, created_at FROM trust_events WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC",
  );

  return {
    create(input) {
      const id = `te_${randomUUID()}`;
      const now = Date.now();
      insertStmt.run(
        id,
        input.agentId,
        input.kind,
        input.fromTier,
        input.toTier,
        input.reason,
        now,
      );
      return {
        id,
        agentId: input.agentId,
        kind: input.kind,
        fromTier: input.fromTier,
        toTier: input.toTier,
        reason: input.reason,
        createdAt: now,
      };
    },
    listByAgent(agentId) {
      const rows = listStmt.all(agentId) as TrustEventRow[];
      return rows.map(rowToEvent);
    },
  };
};
