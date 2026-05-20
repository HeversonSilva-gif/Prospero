import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { IPC, type Routine } from "@prospero/shared";
import { getRoutinesEngine } from "../routines/index.js";
import { computeNextFire } from "../routines/recurrence.js";
import {
  ROUTINE_CREATE_INPUT_SCHEMA,
  ROUTINE_UPDATE_INPUT_SCHEMA,
  type RoutineCreateInput,
  type RoutineUpdateInput,
} from "../schemas/routine.js";

// M15 PR-A — IPC bridge for routines: list / create / update / delete /
// run-now. The engine singleton owns the scheduler + bridge; these handlers
// just shape input + persist. `create` seeds `next_fire_at` for schedule
// routines so the very first tick can find them.

export type RoutinesHandlersDeps = { db: Database.Database };

export type RoutinesHandlers = {
  list(args: { companyId: string }): Routine[];
  create(args: { input: RoutineCreateInput }): Routine;
  update(args: { input: RoutineUpdateInput }): Routine;
  delete(args: { id: string }): { ok: true };
  runNow(args: { id: string }): { ok: true };
};

const seedNextFire = (input: RoutineCreateInput, now: number): number | null => {
  if (input.triggerType !== "schedule") return null;
  return computeNextFire(input.scheduleSpec, new Date(now)).getTime();
};

export const routinesHandlers = (_deps: RoutinesHandlersDeps): RoutinesHandlers => {
  const engine = getRoutinesEngine();
  const repo = engine.repository();

  return {
    list({ companyId }) {
      return repo.listByCompany(companyId);
    },
    create({ input }) {
      const parsed = ROUTINE_CREATE_INPUT_SCHEMA.parse(input);
      const now = Date.now();
      return repo.create({
        companyId: parsed.companyId,
        name: parsed.name,
        enabled: parsed.enabled,
        triggerType: parsed.triggerType,
        scheduleSpec: parsed.triggerType === "schedule" ? parsed.scheduleSpec : null,
        nextFireAt: seedNextFire(parsed, now),
        eventSpec: parsed.triggerType === "event" ? parsed.eventSpec : null,
        targetAgentId: parsed.targetAgentId,
        instruction: parsed.instruction,
      });
    },
    update({ input }) {
      const parsed = ROUTINE_UPDATE_INPUT_SCHEMA.parse(input);

      // M15 PR-B: re-seed nextFireAt when scheduleSpec changes on a schedule
      // routine. Mirror of seedNextFire used in `create`. Skipped if the caller
      // already provided nextFireAt explicitly (e.g. internal advance after fire).
      let computedNextFireAt: number | undefined;
      if (parsed.scheduleSpec !== undefined && parsed.nextFireAt === undefined) {
        const existing = repo.getById(parsed.id);
        if (existing !== null && existing.triggerType === "schedule") {
          computedNextFireAt = computeNextFire(parsed.scheduleSpec, new Date(Date.now())).getTime();
        }
      }

      return repo.update({
        id: parsed.id,
        ...(parsed.name !== undefined && { name: parsed.name }),
        ...(parsed.enabled !== undefined && { enabled: parsed.enabled }),
        ...(parsed.scheduleSpec !== undefined && { scheduleSpec: parsed.scheduleSpec }),
        ...(parsed.eventSpec !== undefined && { eventSpec: parsed.eventSpec }),
        ...(parsed.targetAgentId !== undefined && { targetAgentId: parsed.targetAgentId }),
        ...(parsed.instruction !== undefined && { instruction: parsed.instruction }),
        ...(parsed.nextFireAt !== undefined && { nextFireAt: parsed.nextFireAt }),
        ...(computedNextFireAt !== undefined && { nextFireAt: computedNextFireAt }),
      });
    },
    delete({ id }) {
      repo.delete(id);
      return { ok: true };
    },
    runNow({ id }) {
      engine.runNow(id);
      return { ok: true };
    },
  };
};

export const registerRoutinesHandlers = (db: Database.Database): void => {
  const h = routinesHandlers({ db });
  ipcMain.handle(IPC.ROUTINES_LIST, (_e, args: { companyId: string }) => h.list(args));
  ipcMain.handle(IPC.ROUTINES_CREATE, (_e, args: { input: RoutineCreateInput }) => h.create(args));
  ipcMain.handle(IPC.ROUTINES_UPDATE, (_e, args: { input: RoutineUpdateInput }) => h.update(args));
  ipcMain.handle(IPC.ROUTINES_DELETE, (_e, args: { id: string }) => h.delete(args));
  ipcMain.handle(IPC.ROUTINES_RUN_NOW, (_e, args: { id: string }) => h.runNow(args));
};
