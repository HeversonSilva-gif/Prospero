import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { EventSpec, Routine, RoutineTriggerType, ScheduleSpec } from "@prospero/shared";

// M15 PR-A — RoutinesRepository. Single-table CRUD plus two query helpers used
// by the scheduler (due-by-time) and the event matcher (all enabled event
// routines, cached in-process tick by tick). Mirrors the trust repository
// idiom (lesson project_m14_pr_a_lessons).

export type CreateRoutineInput = {
  companyId: string;
  name: string;
  enabled: boolean;
  triggerType: RoutineTriggerType;
  scheduleSpec: ScheduleSpec | null;
  nextFireAt: number | null;
  eventSpec: EventSpec | null;
  targetAgentId: string;
  instruction: string;
};

export type UpdateRoutineInput = {
  id: string;
  name?: string;
  enabled?: boolean;
  scheduleSpec?: ScheduleSpec | null;
  nextFireAt?: number | null;
  eventSpec?: EventSpec | null;
  targetAgentId?: string;
  instruction?: string;
};

export type RoutinesRepository = {
  create(input: CreateRoutineInput): Routine;
  getById(id: string): Routine | null;
  listByCompany(companyId: string): Routine[];
  listDueSchedule(now: number): Routine[];
  listEnabledEvent(): Routine[];
  update(input: UpdateRoutineInput): Routine;
  delete(id: string): void;
  setNextFireAt(id: string, ts: number | null): void;
  setLastFiredAt(id: string, ts: number): void;
};

type RoutineRow = {
  id: string;
  company_id: string;
  name: string;
  enabled: number;
  trigger_type: RoutineTriggerType;
  schedule_spec: string | null;
  next_fire_at: number | null;
  event_spec: string | null;
  target_agent_id: string;
  instruction: string;
  last_fired_at: number | null;
  created_at: number;
  updated_at: number;
};

const rowToRoutine = (r: RoutineRow): Routine => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  enabled: r.enabled === 1,
  triggerType: r.trigger_type,
  scheduleSpec: r.schedule_spec === null ? null : (JSON.parse(r.schedule_spec) as ScheduleSpec),
  nextFireAt: r.next_fire_at,
  eventSpec: r.event_spec === null ? null : (JSON.parse(r.event_spec) as EventSpec),
  targetAgentId: r.target_agent_id,
  instruction: r.instruction,
  lastFiredAt: r.last_fired_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const createRoutinesRepository = (db: Database.Database): RoutinesRepository => {
  const insertStmt = db.prepare(
    `INSERT INTO routines
       (id, company_id, name, enabled, trigger_type, schedule_spec,
        next_fire_at, event_spec, target_agent_id, instruction,
        last_fired_at, created_at, updated_at)
     VALUES
       (@id, @companyId, @name, @enabled, @triggerType, @scheduleSpec,
        @nextFireAt, @eventSpec, @targetAgentId, @instruction,
        NULL, @createdAt, @updatedAt)`,
  );
  const getStmt = db.prepare("SELECT * FROM routines WHERE id = ?");
  const listByCompanyStmt = db.prepare(
    "SELECT * FROM routines WHERE company_id = ? ORDER BY updated_at DESC, rowid DESC",
  );
  const listDueStmt = db.prepare(
    `SELECT * FROM routines
      WHERE enabled = 1
        AND trigger_type = 'schedule'
        AND next_fire_at IS NOT NULL
        AND next_fire_at <= ?
      ORDER BY next_fire_at ASC, rowid ASC`,
  );
  const listEnabledEventStmt = db.prepare(
    `SELECT * FROM routines
      WHERE enabled = 1 AND trigger_type = 'event'
      ORDER BY updated_at DESC, rowid DESC`,
  );
  const deleteStmt = db.prepare("DELETE FROM routines WHERE id = ?");
  const setNextFireStmt = db.prepare(
    "UPDATE routines SET next_fire_at = ?, updated_at = ? WHERE id = ?",
  );
  const setLastFiredStmt = db.prepare(
    "UPDATE routines SET last_fired_at = ?, updated_at = ? WHERE id = ?",
  );

  return {
    create(input) {
      const id = `routine_${randomUUID()}`;
      const now = Date.now();
      insertStmt.run({
        id,
        companyId: input.companyId,
        name: input.name,
        enabled: input.enabled ? 1 : 0,
        triggerType: input.triggerType,
        scheduleSpec: input.scheduleSpec === null ? null : JSON.stringify(input.scheduleSpec),
        nextFireAt: input.nextFireAt,
        eventSpec: input.eventSpec === null ? null : JSON.stringify(input.eventSpec),
        targetAgentId: input.targetAgentId,
        instruction: input.instruction,
        createdAt: now,
        updatedAt: now,
      });
      const row = getStmt.get(id) as RoutineRow;
      return rowToRoutine(row);
    },

    getById(id) {
      const row = getStmt.get(id) as RoutineRow | undefined;
      return row === undefined ? null : rowToRoutine(row);
    },

    listByCompany(companyId) {
      const rows = listByCompanyStmt.all(companyId) as RoutineRow[];
      return rows.map(rowToRoutine);
    },

    listDueSchedule(now) {
      const rows = listDueStmt.all(now) as RoutineRow[];
      return rows.map(rowToRoutine);
    },

    listEnabledEvent() {
      const rows = listEnabledEventStmt.all() as RoutineRow[];
      return rows.map(rowToRoutine);
    },

    update(input) {
      const existing = getStmt.get(input.id) as RoutineRow | undefined;
      if (existing === undefined) throw new Error(`routine ${input.id} not found`);
      const next: RoutineRow = {
        ...existing,
        name: input.name ?? existing.name,
        enabled: input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
        schedule_spec:
          input.scheduleSpec === undefined
            ? existing.schedule_spec
            : input.scheduleSpec === null
              ? null
              : JSON.stringify(input.scheduleSpec),
        next_fire_at: input.nextFireAt === undefined ? existing.next_fire_at : input.nextFireAt,
        event_spec:
          input.eventSpec === undefined
            ? existing.event_spec
            : input.eventSpec === null
              ? null
              : JSON.stringify(input.eventSpec),
        target_agent_id: input.targetAgentId ?? existing.target_agent_id,
        instruction: input.instruction ?? existing.instruction,
        updated_at: Date.now(),
      };
      db.prepare(
        `UPDATE routines SET
           name = @name,
           enabled = @enabled,
           schedule_spec = @schedule_spec,
           next_fire_at = @next_fire_at,
           event_spec = @event_spec,
           target_agent_id = @target_agent_id,
           instruction = @instruction,
           updated_at = @updated_at
         WHERE id = @id`,
      ).run(next);
      return rowToRoutine(next);
    },

    delete(id) {
      deleteStmt.run(id);
    },

    setNextFireAt(id, ts) {
      setNextFireStmt.run(ts, Date.now(), id);
    },

    setLastFiredAt(id, ts) {
      setLastFiredStmt.run(ts, Date.now(), id);
    },
  };
};
