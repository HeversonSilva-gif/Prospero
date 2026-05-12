// Lazy roll-up: emits a cost.day_summary activity row once per agent per UTC
// day, when the agent has at least one cost_event from "yesterday".
// Idempotency via a SELECT against activity_events filtered by action +
// agent_id + created_at window of today.

import type Database from "better-sqlite3";
import type { Recorder as ActivityRecorder } from "../activity/recorder.js";
import type { CostsRepository } from "./repository.js";

export type RollUpDeps = {
  db: Database.Database;
  now: () => number;
  companyId: string;
  agentId: string;
  costsRepo: CostsRepository;
  activityRecorder: ActivityRecorder;
};

const utcDayStart = (ts: number): number => {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export const rollUpYesterdayIfNeeded = (deps: RollUpDeps): void => {
  const todayStart = utcDayStart(deps.now());
  const yesterdayStart = todayStart - 86_400_000;
  const yesterdayDate = new Date(yesterdayStart);

  if (!deps.costsRepo.hasAgentRowsForDay(deps.agentId, yesterdayDate)) return;

  const alreadyDone = deps.db
    .prepare(
      `SELECT 1 AS hit FROM activity_events
       WHERE action = 'cost.day_summary'
         AND agent_id = ?
         AND created_at >= ?
       LIMIT 1`,
    )
    .get(deps.agentId, todayStart) as { hit: number } | undefined;
  if (alreadyDone !== undefined) return;

  const totals = deps.db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS input,
         COALESCE(SUM(output_tokens), 0) AS output,
         COALESCE(SUM(cost_cents_estimate), 0) AS cents
       FROM cost_events
       WHERE agent_id = ?
         AND occurred_at >= ?
         AND occurred_at < ?`,
    )
    .get(deps.agentId, yesterdayStart, todayStart) as {
    input: number;
    output: number;
    cents: number;
  };

  deps.activityRecorder.recordActivity({
    companyId: deps.companyId,
    actor: { kind: "system" },
    action: "cost.day_summary",
    entityKind: "agent",
    entityId: deps.agentId,
    agentId: deps.agentId,
    payload: {
      inputTokens: totals.input,
      outputTokens: totals.output,
      totalUsd: totals.cents / 100,
    },
  });
};
