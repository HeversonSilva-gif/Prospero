import type Database from "better-sqlite3";
import { startSchedulerTick } from "../orchestrator/scheduler-tick.js";
import { runCuratorPass } from "./pass.js";
import { runDerivation, defaultRunProcess, type RunProcess } from "../derivation/runner.js";

const HOURLY_MS = 60 * 60 * 1000;

// Starts the Curator: runs one pass immediately (boot catch-up) then every hour.
// The pass itself throttles the expensive librarian fork to once per 7 days; the
// hourly cadence just makes the lifecycle sweep + the weekly-due check survive a
// long-running app (the autonomous loop keeps the process up for days). authEnv
// resolves the headless fork's credentials (pass `() => buildAuthEnv(db)`).
export const startCuratorTick = (
  db: Database.Database,
  authEnv: () => Record<string, string>,
  runProcess: RunProcess = defaultRunProcess,
): (() => void) => {
  const runPass = (): void => {
    void runCuratorPass({
      db,
      now: Date.now(),
      runDerivation: (input) => runDerivation({ runProcess }, input),
      authEnv,
    }).catch((err) => console.warn(`[curator] pass failed: ${String(err)}`));
  };
  runPass(); // boot catch-up
  return startSchedulerTick(runPass, HOURLY_MS);
};
