import type Database from "better-sqlite3";
import type { Issue } from "@dashboard-agent/shared";
import { createIssuesRepository } from "./repository.js";

// Returns issues that:
//   1. Reference doneIssueId in their depends_on_json
//   2. Are currently in status='todo' (already-doing/done issues don't re-wake)
//   3. Have ALL their other deps already in status='done'
// Caller is responsible for invoking notifyAssignee + recording activity.
export const computeUnlockedDependents = (
  db: Database.Database,
  doneIssueId: string,
  companyId: string,
): Issue[] => {
  const repo = createIssuesRepository(db);
  const candidates = repo.findDependentsOf(doneIssueId, companyId);
  return candidates.filter((cand) => {
    if (cand.status !== "todo") return false;
    const row = db.prepare("SELECT depends_on_json FROM issues WHERE id = ?").get(cand.id) as
      | { depends_on_json: string | null }
      | undefined;
    if (row === undefined || row.depends_on_json === null) return false;
    let depIds: string[];
    try {
      const parsed = JSON.parse(row.depends_on_json) as unknown;
      if (!Array.isArray(parsed)) return false;
      depIds = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      return false;
    }
    return depIds.every((depId) => {
      const dep = repo.getById(depId);
      return dep !== null && dep.status === "done";
    });
  });
};
