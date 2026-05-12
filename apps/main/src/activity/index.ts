// Activity Stream public API (M7.7) — lazy singleton accessor for the recorder.
//
// Handler files that already instantiate their repositories (inbox-handlers,
// issues-handlers, etc.) call `getRecorder()` to obtain the shared instance.
// Production: `initRecorder(db)` is called once at the top of
// `registerIpcHandlers` before any handler can run.
// Tests: build their own recorder via `createRecorder(db, vi.fn(), ...)` and
// never touch the singleton — `_setRecorderForTest` exists only as an escape
// hatch if a test ever needs to stub the global instance.

import type Database from "better-sqlite3";
import { createRecorder, type Recorder } from "./recorder.js";
import { broadcastActivityNew } from "../ipc/activity-broadcast.js";

let _recorder: Recorder | null = null;

export const initRecorder = (db: Database.Database): Recorder => {
  const isDev = process.env.NODE_ENV !== "production";
  _recorder = createRecorder(db, broadcastActivityNew, { devMode: isDev });
  return _recorder;
};

export const getRecorder = (): Recorder => {
  if (_recorder === null) {
    throw new Error("Recorder not initialized — call initRecorder(db) first");
  }
  return _recorder;
};

// Soft variant for handler files that may be exercised in tests that skip
// initRecorder (and thus skip dual-write). Returns undefined when uninitialized.
export const tryGetRecorder = (): Recorder | undefined => _recorder ?? undefined;

export const _setRecorderForTest = (rec: Recorder | null): void => {
  _recorder = rec;
};

export type { Recorder, RecordActivityInput, RecorderOptions } from "./recorder.js";
export { createRecorder } from "./recorder.js";
