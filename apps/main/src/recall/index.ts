// Recall module public API — activity observer factory.
// Wired into registerIpcHandlers alongside initDerivation and routinesEngine.

import type Database from "better-sqlite3";
import type { ActivityEventRow } from "@prospero/shared";
import type { Router } from "../orchestrator/router.js";
import { createIssuesRepository } from "../issues/repository.js";
import { recallForIssue, formatRecallSeed } from "./recall.js";

// Build the recall observer. Called once from registerIpcHandlers after the
// router is available. Returns an `onActivity` callback that mirrors the same
// pattern as initDerivation.onActivity.
export const initRecall = (
  db: Database.Database,
  router: Router,
): { onActivity: (row: ActivityEventRow) => void } => {
  const onActivity = (row: ActivityEventRow): void => {
    // Trigger on issue.assignee_changed (when a new assignee is set) or
    // issue.created (when it ships with an assigneeAgentId).
    let assigneeAgentId: string | null = null;

    if (row.action === "issue.assignee_changed") {
      // payload: { from: string | null, to: string | null }
      const payload = row.payload as { from: string | null; to: string | null };
      assigneeAgentId = payload.to;
    } else if (row.action === "issue.created") {
      // payload: { identifier: string, title: string, assigneeAgentId: string | null }
      const payload = row.payload as {
        identifier: string;
        title: string;
        assigneeAgentId: string | null;
      };
      assigneeAgentId = payload.assigneeAgentId;
    }

    if (assigneeAgentId === null || assigneeAgentId === "") return;

    // Resolve the issue to get its title + description.
    const issueId = row.entityId;
    let issue: { title: string; description: string | null; companyId: string } | null = null;
    try {
      const row2 = createIssuesRepository(db).getById(issueId);
      if (row2 === null) return;
      issue = { title: row2.title, description: row2.description, companyId: row2.companyId };
    } catch {
      return;
    }

    const issueText = issue.title + (issue.description ? "\n" + issue.description : "");

    let hits;
    try {
      hits = recallForIssue(db, {
        companyId: issue.companyId,
        agentId: assigneeAgentId,
        issueText,
      });
    } catch {
      return;
    }

    const seed = formatRecallSeed(hits);
    if (seed === null) return;

    router.setPendingSeedIfAbsent(assigneeAgentId, seed);
  };

  return { onActivity };
};
