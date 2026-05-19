// Disk I/O for goal ISAs. The on-disk isa.md is the source of truth once it
// exists. ensureIsa is the lazy materializer (mirrors the M12 PR-C ensureBundle
// pattern — materialization is lazy, there is no SQL post-migration): the first
// time a goal's ISA is touched, isa.md is written from the skeleton, seeding
// the Vision section from the goal's legacy successCriteria.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Goal } from "@prospero/shared";
import { buildIsaSkeleton } from "@prospero/shared";
import { getGoalIsaDir, goalIsaPath } from "./isa-dir.js";

// Materializes isa.md the first time it is accessed. Idempotent — once the file
// exists, does nothing (so user edits are never clobbered).
export const ensureIsa = (userDataDir: string, goal: Goal): void => {
  const path = goalIsaPath(userDataDir, goal.companyId, goal.id);
  if (existsSync(path)) return;
  getGoalIsaDir(userDataDir, goal.companyId, goal.id); // ensures the directory
  const vision = goal.successCriteria?.trim();
  writeFileSync(
    path,
    buildIsaSkeleton(vision !== undefined && vision !== "" ? { vision } : {}),
    "utf8",
  );
};

// Reads the isa.md body, materializing it first if needed.
export const readIsa = (userDataDir: string, goal: Goal): string => {
  ensureIsa(userDataDir, goal);
  return readFileSync(goalIsaPath(userDataDir, goal.companyId, goal.id), "utf8");
};

// Writes the isa.md body, creating the directory if needed.
export const writeIsa = (userDataDir: string, goal: Goal, body: string): void => {
  getGoalIsaDir(userDataDir, goal.companyId, goal.id);
  writeFileSync(goalIsaPath(userDataDir, goal.companyId, goal.id), body, "utf8");
};

// Whether a goal's isa.md has been materialized. Takes raw ids instead of a
// Goal so callers with only IPC-level ids (companyId + goalId) need not
// hydrate the full Goal object.
export const isaExists = (userDataDir: string, companyId: string, goalId: string): boolean =>
  existsSync(goalIsaPath(userDataDir, companyId, goalId));
