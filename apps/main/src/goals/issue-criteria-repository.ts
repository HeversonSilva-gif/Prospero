import type Database from "better-sqlite3";

// The issue_criteria join: which ISCs an issue advances (spec §5.3).
export type IssueCriteriaRepository = {
  // Idempotent — links an issue to a criterion.
  link(issueId: string, criterionId: string): void;
  listCriteriaForIssue(issueId: string): string[];
  listIssuesForCriterion(criterionId: string): string[];
};

export const createIssueCriteriaRepository = (db: Database.Database): IssueCriteriaRepository => {
  const linkStmt = db.prepare(
    "INSERT OR IGNORE INTO issue_criteria (issue_id, criterion_id) VALUES (?, ?)",
  );
  const critsForIssueStmt = db.prepare(
    "SELECT criterion_id FROM issue_criteria WHERE issue_id = ?",
  );
  const issuesForCritStmt = db.prepare(
    "SELECT issue_id FROM issue_criteria WHERE criterion_id = ?",
  );
  return {
    link: (issueId, criterionId) => {
      linkStmt.run(issueId, criterionId);
    },
    listCriteriaForIssue: (issueId) =>
      (critsForIssueStmt.all(issueId) as { criterion_id: string }[]).map((r) => r.criterion_id),
    listIssuesForCriterion: (criterionId) =>
      (issuesForCritStmt.all(criterionId) as { issue_id: string }[]).map((r) => r.issue_id),
  };
};
