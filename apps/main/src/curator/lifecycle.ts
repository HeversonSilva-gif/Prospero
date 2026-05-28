import type Database from "better-sqlite3";
import type { SkillLifecycleState } from "@prospero/shared";
import { createSkillsRepository } from "../memory/skills-repository.js";
import { createInboxRepository } from "../inbox/repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// A skill unused this long becomes `stale` (still in L0, with a one-time
// inbox warning); unused this long becomes `archived` (drops out of L0).
export const STALE_DAYS = 30;
export const ARCHIVE_DAYS = 90;

// Pure: where a skill belongs given the wall-clock gap since it was last touched
// (last_used ?? created_at). Boundaries are inclusive of the threshold.
export const nextLifecycleState = (lastTouched: number, now: number): SkillLifecycleState => {
  const elapsedDays = (now - lastTouched) / DAY_MS;
  if (elapsedDays < STALE_DAYS) return "active";
  if (elapsedDays < ARCHIVE_DAYS) return "stale";
  return "archived";
};

export type LifecyclePassResult = { toStale: number; toArchived: number; revived: number };

type LifecycleRow = {
  id: string;
  company_id: string;
  name: string;
  last_used: number | null;
  created_at: number;
  promoted: number;
  lifecycle_state: string;
};

// Applies the automatic lifecycle transitions. Runs every tick (cheap — a single
// scan). Promoted (company-shared) skills are protected from auto-archival: they
// can fade to `stale` but never auto-`archived` (only a fork proposal the user
// approves can retire them). Posts a one-time inbox notice per transition.
export const runLifecyclePass = (db: Database.Database, now: number): LifecyclePassResult => {
  const skillsRepo = createSkillsRepository(db);
  const inboxRepo = createInboxRepository(db);
  const rows = db
    .prepare(
      "SELECT id, company_id, name, last_used, created_at, promoted, lifecycle_state " +
        "FROM skills WHERE soft_deleted = 0",
    )
    .all() as LifecycleRow[];

  let toStale = 0;
  let toArchived = 0;
  for (const row of rows) {
    const lastTouched = row.last_used ?? row.created_at;
    let target = nextLifecycleState(lastTouched, now);
    if (target === "archived" && row.promoted === 1) target = "stale";
    if (target === row.lifecycle_state) continue;

    skillsRepo.setLifecycleState(row.id, target, now);
    if (target === "stale") {
      toStale += 1;
      inboxRepo.create({
        companyId: row.company_id,
        kind: "memory_review_needed",
        title: `Skill fading: ${row.name}`,
        preview: `"${row.name}" hasn't been used in ${STALE_DAYS}+ days.`,
        requiresAction: false,
        payloadJson: JSON.stringify({ skillId: row.id, reason: "skill_stale" }),
      });
    } else if (target === "archived") {
      toArchived += 1;
      inboxRepo.create({
        companyId: row.company_id,
        kind: "memory_review_needed",
        title: `Skill archived: ${row.name}`,
        preview: `"${row.name}" was archived after ${ARCHIVE_DAYS}+ days unused. It stays reachable on demand.`,
        requiresAction: false,
        payloadJson: JSON.stringify({ skillId: row.id, reason: "skill_archived" }),
      });
    }
  }
  return { toStale, toArchived, revived: 0 };
};
