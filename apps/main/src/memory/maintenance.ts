import type Database from "better-sqlite3";
import { createMemoriesRepository } from "./memories-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
import { decayedImportance } from "./decay.js";

// M11 PR-F1: the once-per-session memory hygiene pass.
//
// Each pass recomputes `memories.importance` from the real time elapsed since
// the previous pass, posts a `memory_review_needed` inbox notice when a memory
// fades into the danger zone or is pruned, and soft-deletes memories that are
// both unimportant and stale. Pinned and `identity` memories are exempt
// (excluded by memoriesRepo.listDecayCandidates).

const DAY_MS = 24 * 60 * 60 * 1000;
// The pass runs at most once per ~day even if the app is relaunched often.
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
// Importance below this AND staleness past STALE_DAYS => prune.
const PRUNE_IMPORTANCE = 0.1;
// Importance dropping below this (without being pruned) => one-time warning.
const WARN_IMPORTANCE = 0.2;
// A memory is "stale" when it has not been touched in this many days.
const STALE_DAYS = 30;
// A skill soft-deleted (e.g. by the terminate-promote cascade) is hard-removed
// once it has sat soft-deleted this many days.
const SKILL_PURGE_DAYS = 30;
// The settings key holding the last pass's wall-clock time (ms, as a string).
const LAST_RUN_KEY = "memory_maintenance_last_run";

export type MaintenanceResult = {
  ran: boolean;
  decayed: number;
  warned: number;
  pruned: number;
  purgedSkills: number;
  purgedMemories: number;
};

const readLastRun = (db: Database.Database): number | null => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(LAST_RUN_KEY) as
    | { value: string }
    | undefined;
  if (row === undefined) return null;
  const ms = Number(row.value);
  return Number.isFinite(ms) ? ms : null;
};

const writeLastRun = (db: Database.Database, now: number): void => {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(LAST_RUN_KEY, String(now));
};

// Runs the decay/prune/warn pass. `now` is injected for testability.
export const runMemoryMaintenance = (db: Database.Database, now: number): MaintenanceResult => {
  const lastRun = readLastRun(db);

  // Throttle: at most one pass per ~day.
  if (lastRun !== null && now - lastRun < MIN_INTERVAL_MS) {
    return { ran: false, decayed: 0, warned: 0, pruned: 0, purgedSkills: 0, purgedMemories: 0 };
  }

  // First-ever run: record the baseline, decay nothing (elapsed is unknown).
  if (lastRun === null) {
    writeLastRun(db, now);
    return { ran: true, decayed: 0, warned: 0, pruned: 0, purgedSkills: 0, purgedMemories: 0 };
  }

  const elapsedDays = (now - lastRun) / DAY_MS;
  const memoriesRepo = createMemoriesRepository(db);
  const inboxRepo = createInboxRepository(db);

  let decayed = 0;
  let warned = 0;
  let pruned = 0;

  for (const m of memoriesRepo.listDecayCandidates()) {
    const before = m.importance;
    const after = decayedImportance(before, m.accessCount, elapsedDays);
    memoriesRepo.update(m.id, { importance: after });
    decayed += 1;

    const lastTouched = m.lastAccessed ?? m.createdAt;
    const stale = now - lastTouched > STALE_DAYS * DAY_MS;

    if (after < PRUNE_IMPORTANCE && stale) {
      memoriesRepo.softDelete(m.id);
      inboxRepo.create({
        companyId: m.companyId,
        kind: "memory_review_needed",
        title: "Memory pruned",
        preview: m.body.slice(0, 200),
        requiresAction: false,
        payloadJson: JSON.stringify({ memoryId: m.id, reason: "pruned" }),
      });
      pruned += 1;
    } else if (before >= WARN_IMPORTANCE && after < WARN_IMPORTANCE) {
      inboxRepo.create({
        companyId: m.companyId,
        kind: "memory_review_needed",
        title: "Memory fading",
        preview: m.body.slice(0, 200),
        requiresAction: false,
        payloadJson: JSON.stringify({ memoryId: m.id, reason: "fading" }),
      });
      warned += 1;
    }
  }

  // M11 PR-F2: hard-purge skills soft-deleted past the 30-day grace period.
  // The skill's SKILL.md body file on disk is intentionally left behind — it is
  // unreachable once the row is gone, and the 30-day grace bounds the leak.
  const purgeBefore = now - SKILL_PURGE_DAYS * DAY_MS;
  const purgedSkills = db
    .prepare(
      "DELETE FROM skills WHERE soft_deleted = 1 AND soft_deleted_at IS NOT NULL AND soft_deleted_at < ?",
    )
    .run(purgeBefore).changes;

  // v0.2.4: hard-purge memories soft-deleted past the 30-day grace period,
  // removing their memories_fts rows at the same time.
  const purgedMemories = memoriesRepo.purgeSoftDeleted(purgeBefore);

  writeLastRun(db, now);
  return { ran: true, decayed, warned, pruned, purgedSkills, purgedMemories };
};
