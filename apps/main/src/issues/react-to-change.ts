import type Database from "better-sqlite3";
import type { Issue } from "@prospero/shared";
import { createIssuesRepository } from "./repository.js";
import { computeUnlockedDependents } from "./topo-activation.js";
import { maybeStartVerification } from "../verification/trigger.js";
import type { RunVerificationDeps } from "../verification/index.js";

// Single shared reaction to an issue change, called by BOTH the renderer IPC
// handler (issues-handlers) AND the MAIN consumer of the MCP-emitted
// `issue.updated`/`issue.created` event (orchestrator-handlers). Previously this
// logic lived ONLY in the renderer handler, so an AGENT-driven completion
// (update_issue MCP tool) never triggered verification — the goal was stranded
// `in_progress` forever and the autonomous loop never closed. Audit 2026-06-03
// C1. `maybeStartVerification` is self-guarded (only fires when the goal is
// `in_progress` and every issue is terminal), so calling this on any change is
// idempotent. Returns the dependents a `done` transition unlocked, so the
// caller can wake them with its own delivery mechanism (notifyAssignee).
export const reactToIssueChange = (
  db: Database.Database,
  issueId: string,
  deps: RunVerificationDeps,
): Issue[] => {
  const issue = createIssuesRepository(db).getById(issueId);
  if (issue === null) return [];
  const unlocked =
    issue.status === "done" ? computeUnlockedDependents(db, issue.id, issue.companyId) : [];
  maybeStartVerification(db, issue, deps);
  return unlocked;
};
