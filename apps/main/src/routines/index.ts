import type Database from "better-sqlite3";
import { createRoutinesEngine, type RoutinesEngine } from "./engine.js";
import { getRecorder } from "../activity/index.js";

// Lazy singleton accessor (mirrors apps/main/src/activity/index.ts and
// apps/main/src/inbox/index.ts). `initRoutinesEngine(db)` is called once
// from registerIpcHandlers, AFTER initRecorder so getRecorder() is wired.

let _engine: RoutinesEngine | null = null;

export const initRoutinesEngine = (db: Database.Database): RoutinesEngine => {
  const recorder = getRecorder();
  _engine = createRoutinesEngine({
    db,
    now: () => Date.now(),
    tickMs: 30_000,
    recordActivity: (input) => recorder.recordActivity(input),
  });
  return _engine;
};

export const getRoutinesEngine = (): RoutinesEngine => {
  if (_engine === null) {
    throw new Error("Routines engine not initialized — call initRoutinesEngine(db) first");
  }
  return _engine;
};

export const tryGetRoutinesEngine = (): RoutinesEngine | null => _engine;

export const _setRoutinesEngineForTest = (e: RoutinesEngine | null): void => {
  _engine = e;
};

export type { RoutinesEngine, RoutinesEngineBridge } from "./engine.js";
export { createRoutinesEngine } from "./engine.js";
