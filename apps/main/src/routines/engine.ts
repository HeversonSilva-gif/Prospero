import type Database from "better-sqlite3";
import type { ActivityEventRow, Agent, FireReason, Routine } from "@prospero/shared";
import type { RecordActivityInput } from "../activity/recorder.js";
import type { Sender } from "../orchestrator/router.js";
import { computeNextFire } from "./recurrence.js";
import { routinesForActivity } from "./event-matcher.js";
import { createRoutinesRepository, type RoutinesRepository } from "./repository.js";
import { createRoutineScheduler, type RoutineScheduler } from "./scheduler.js";
import { fireRoutine } from "./fire.js";

// M15 PR-A — engine composes scheduler + event-matcher + fire. The bridge
// (router / ensureAgentRunner / agent lookup) is injected at `start` so this
// module stays decoupled from orchestrator-handlers wiring.

export interface RoutinesEngineDeps {
  db: Database.Database;
  now: () => number;
  tickMs: number;
  recordActivity: (input: RecordActivityInput) => void;
}

export interface RoutinesEngineBridge {
  getAgent: (id: string) => Agent | null;
  ensureAgentRunner: (agent: Agent) => void;
  enqueue: (agentId: string, threadId: string, content: string, sender: Sender) => void;
  primaryThreadId: (agentId: string) => string;
}

export interface RoutinesEngine {
  start(bridge: RoutinesEngineBridge): void;
  stop(): void;
  onActivity(row: ActivityEventRow): void;
  runNow(routineId: string): void;
  repository(): RoutinesRepository;
}

const DEFAULT_TICK_MS = 30_000;

export const createRoutinesEngine = (deps: RoutinesEngineDeps): RoutinesEngine => {
  const repo = createRoutinesRepository(deps.db);
  let bridge: RoutinesEngineBridge | null = null;
  let scheduler: RoutineScheduler | null = null;

  const fire = (routine: Routine, reason: FireReason): void => {
    if (bridge === null) return;
    fireRoutine(routine, reason, {
      getAgent: bridge.getAgent,
      ensureAgentRunner: bridge.ensureAgentRunner,
      enqueue: bridge.enqueue,
      primaryThreadId: bridge.primaryThreadId,
      recordActivity: deps.recordActivity,
    });
    repo.setLastFiredAt(routine.id, deps.now());
  };

  const advanceNextFire = (routine: Routine, now: number): void => {
    if (routine.scheduleSpec === null) return;
    const next = computeNextFire(routine.scheduleSpec, new Date(now));
    repo.setNextFireAt(routine.id, next.getTime());
  };

  return {
    start(b) {
      bridge = b;
      scheduler = createRoutineScheduler({
        now: deps.now,
        listDueSchedule: (now) => repo.listDueSchedule(now),
        fire,
        advanceNextFire,
        tickMs: deps.tickMs || DEFAULT_TICK_MS,
      });
      scheduler.start();
    },
    stop() {
      scheduler?.stop();
      scheduler = null;
      bridge = null;
    },
    onActivity(row) {
      if (bridge === null) return;
      const enabledEvent = repo.listEnabledEvent();
      const matches = routinesForActivity(row, enabledEvent);
      for (const r of matches) {
        fire(r, "event");
      }
    },
    runNow(routineId) {
      if (bridge === null) throw new Error("routines engine not started");
      const r = repo.getById(routineId);
      if (r === null) throw new Error(`routine ${routineId} not found`);
      fire(r, "manual");
      if (r.triggerType === "schedule") {
        advanceNextFire(r, deps.now());
      }
    },
    repository: () => repo,
  };
};
