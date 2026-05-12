// Central helper for the Activity Stream (M7.7).
//
// Validates payload shape via Zod (devMode throws on mismatch, prod warns +
// falls back to {}), enforces a 4KB payload cap (devMode throws, prod truncates
// + sets `_truncated: true`), inserts the row, and broadcasts via the injected
// callback. The broadcast callback is injected (not imported) so the recorder
// can be unit-tested without booting electron.

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ActivityAction, ActivityEventRow, Actor, EntityKind } from "@dashboard-agent/shared";
import { ActivityPayloads } from "./schemas.js";

const MAX_PAYLOAD_BYTES = 4096;

export interface RecordActivityInput {
  companyId: string;
  actor: Actor;
  action: ActivityAction;
  entityKind: EntityKind;
  entityId: string;
  agentId?: string | null;
  payload: Record<string, unknown>;
}

export interface RecorderOptions {
  devMode: boolean;
}

export interface Recorder {
  recordActivity(input: RecordActivityInput): ActivityEventRow;
}

export const createRecorder = (
  db: Database.Database,
  broadcast: (row: ActivityEventRow) => void,
  opts: RecorderOptions,
): Recorder => {
  const insertStmt = db.prepare(
    `INSERT INTO activity_events
       (id, company_id, actor_kind, actor_id, action, entity_kind, entity_id, agent_id, payload_json, created_at)
     VALUES
       (@id, @companyId, @actorKind, @actorId, @action, @entityKind, @entityId, @agentId, @payloadJson, @createdAt)`,
  );

  const recordActivity = (input: RecordActivityInput): ActivityEventRow => {
    // 1. Action vocabulary check.
    const schema = (
      ActivityPayloads as Record<string, (typeof ActivityPayloads)[ActivityAction] | undefined>
    )[input.action];
    if (schema === undefined) {
      if (opts.devMode) {
        throw new Error(`[activity] unknown action: ${String(input.action)}`);
      }
      console.warn(`[activity] unknown action skipped: ${String(input.action)}`);
      return persist(input, {});
    }

    // 2. Validate payload via Zod.
    const parsed = schema.safeParse(input.payload);
    let safePayload: Record<string, unknown>;
    if (parsed.success) {
      safePayload = parsed.data;
    } else if (opts.devMode) {
      throw new Error(
        `[activity] payload validation failed for ${input.action}: ${parsed.error.message}`,
      );
    } else {
      console.warn(
        `[activity] payload validation failed for ${input.action}; falling back to {}`,
        parsed.error.message,
      );
      safePayload = {};
    }

    // 3. Size cap.
    let payloadJson = JSON.stringify(safePayload);
    if (payloadJson.length > MAX_PAYLOAD_BYTES) {
      if (opts.devMode) {
        throw new Error(
          `[activity] payload size ${payloadJson.length}B exceeds ${MAX_PAYLOAD_BYTES}B for ${input.action}`,
        );
      }
      safePayload = truncateStrings(safePayload, MAX_PAYLOAD_BYTES);
      safePayload._truncated = true;
      payloadJson = JSON.stringify(safePayload);
      if (payloadJson.length > MAX_PAYLOAD_BYTES) {
        // Last-resort hard slice; keep JSON parseable by closing the object.
        payloadJson = payloadJson.slice(0, MAX_PAYLOAD_BYTES - 1).replace(/[^"}]*$/, "") + "}";
      }
    }

    return persist(input, safePayload, payloadJson);
  };

  const persist = (
    input: RecordActivityInput,
    payload: Record<string, unknown>,
    payloadJsonOverride?: string,
  ): ActivityEventRow => {
    const actorKind = input.actor.kind;
    const actorId = input.actor.kind === "agent" ? input.actor.id : null;
    const agentId =
      input.agentId !== undefined
        ? input.agentId
        : input.actor.kind === "agent"
          ? input.actor.id
          : null;

    const id = `act_${randomUUID()}`;
    const createdAt = Date.now();
    const payloadJson = payloadJsonOverride ?? JSON.stringify(payload);

    insertStmt.run({
      id,
      companyId: input.companyId,
      actorKind,
      actorId,
      action: input.action,
      entityKind: input.entityKind,
      entityId: input.entityId,
      agentId,
      payloadJson,
      createdAt,
    });

    const row: ActivityEventRow = {
      id,
      companyId: input.companyId,
      actorKind,
      actorId,
      action: input.action,
      entityKind: input.entityKind,
      entityId: input.entityId,
      agentId,
      payload: JSON.parse(payloadJson) as Record<string, unknown>,
      createdAt,
    };

    try {
      broadcast(row);
    } catch (err) {
      console.warn("[activity] broadcast failed", err);
    }
    return row;
  };

  return { recordActivity };
};

const truncateStrings = (
  obj: Record<string, unknown>,
  targetBytes: number,
): Record<string, unknown> => {
  // Naive proportional truncation: shrink every string field by half until under cap.
  const out: Record<string, unknown> = { ...obj };
  let attempts = 0;
  while (JSON.stringify(out).length > targetBytes - 30 && attempts < 12) {
    for (const key of Object.keys(out)) {
      const val = out[key];
      if (typeof val === "string" && val.length > 20) {
        out[key] = val.slice(0, Math.max(20, Math.floor(val.length / 2)));
      }
    }
    attempts += 1;
  }
  return out;
};
