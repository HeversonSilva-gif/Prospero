import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { IssueArtifact, IssueArtifactKind } from "@prospero/shared";

type Row = {
  id: string;
  issue_id: string;
  kind: string;
  ref: string;
  content_preview: string | null;
  created_by: string | null;
  created_at: number;
};

const rowToArtifact = (r: Row): IssueArtifact => ({
  id: r.id,
  issueId: r.issue_id,
  kind: r.kind as IssueArtifactKind,
  ref: r.ref,
  contentPreview: r.content_preview,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export type CreateArtifactInput = {
  issueId: string;
  kind: IssueArtifactKind;
  ref: string;
  contentPreview: string | null;
  createdBy: string | null;
};

export type ArtifactsRepository = {
  create(input: CreateArtifactInput): IssueArtifact;
  listByIssue(issueId: string, limit?: number): IssueArtifact[];
  countForIssue(issueId: string): number;
};

export const createArtifactsRepository = (db: Database.Database): ArtifactsRepository => {
  const insert = db.prepare(
    `INSERT INTO issue_artifacts (id, issue_id, kind, ref, content_preview, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const byId = db.prepare("SELECT * FROM issue_artifacts WHERE id = ?");
  const listStmt = db.prepare(
    // rowid DESC tiebreaks artifacts inserted within the same millisecond so
    // the "most recent" sort is deterministic on faster machines too.
    `SELECT * FROM issue_artifacts WHERE issue_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM issue_artifacts WHERE issue_id = ?");

  return {
    create(input) {
      const id = `art_${randomUUID()}`;
      insert.run(
        id,
        input.issueId,
        input.kind,
        input.ref,
        input.contentPreview,
        input.createdBy,
        Date.now(),
      );
      return rowToArtifact(byId.get(id) as Row);
    },
    listByIssue(issueId, limit = 20) {
      return (listStmt.all(issueId, limit) as Row[]).map(rowToArtifact);
    },
    countForIssue(issueId) {
      const row = countStmt.get(issueId) as { n: number };
      return row.n;
    },
  };
};
