import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { InboxItem, InboxKind } from "@prospero/shared";

type Row = {
  id: string;
  company_id: string;
  kind: string;
  actor_id: string | null;
  title: string;
  preview: string | null;
  payload_json: string | null;
  requires_action: number;
  approval_id: string | null;
  read_at: number | null;
  created_at: number;
};

const rowToItem = (r: Row): InboxItem => ({
  id: r.id,
  companyId: r.company_id,
  kind: r.kind as InboxKind,
  actorId: r.actor_id,
  title: r.title,
  preview: r.preview,
  payloadJson: r.payload_json,
  requiresAction: r.requires_action === 1,
  approvalId: r.approval_id,
  readAt: r.read_at,
  createdAt: r.created_at,
});

export type CreateInboxInput = {
  companyId: string;
  kind: InboxKind;
  actorId?: string | null;
  title: string;
  preview?: string | null;
  requiresAction?: boolean;
  payloadJson?: string | null;
  approvalId?: string | null;
};

export type InboxRepository = {
  create(input: CreateInboxInput): InboxItem;
  listByCompany(companyId: string): InboxItem[];
  markRead(id: string): void;
  markReadByToolUseId(toolUseId: string): InboxItem | null;
  markReadByApprovalId(approvalId: string): InboxItem | null;
};

export const createInboxRepository = (db: Database.Database): InboxRepository => {
  const insert = db.prepare(`
    INSERT INTO inbox_items (id, company_id, kind, actor_id, title, preview, payload_json, requires_action, approval_id, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `);
  const list = db.prepare(
    "SELECT * FROM inbox_items WHERE company_id = ? ORDER BY created_at DESC",
  );
  const markReadStmt = db.prepare("UPDATE inbox_items SET read_at = ? WHERE id = ?");

  return {
    create(input) {
      const id = `inb_${randomUUID()}`;
      const now = Date.now();
      insert.run(
        id,
        input.companyId,
        input.kind,
        input.actorId ?? null,
        input.title,
        input.preview ?? null,
        input.payloadJson ?? null,
        input.requiresAction === true ? 1 : 0,
        input.approvalId ?? null,
        now,
      );
      return {
        id,
        companyId: input.companyId,
        kind: input.kind,
        actorId: input.actorId ?? null,
        title: input.title,
        preview: input.preview ?? null,
        payloadJson: input.payloadJson ?? null,
        requiresAction: input.requiresAction === true,
        approvalId: input.approvalId ?? null,
        readAt: null,
        createdAt: now,
      };
    },
    listByCompany(companyId) {
      const rows = list.all(companyId) as Row[];
      return rows.map(rowToItem);
    },
    markRead(id) {
      markReadStmt.run(Date.now(), id);
    },
    markReadByToolUseId(toolUseId) {
      // Legacy fallback for inbox items written before approval_id existed —
      // their payload_json embeds the toolUseId. Naive substring match is
      // adequate for the small inbox sizes expected in v1.
      const row = db
        .prepare(
          `SELECT * FROM inbox_items WHERE kind = 'approval' AND read_at IS NULL AND payload_json LIKE ? LIMIT 1`,
        )
        .get(`%${toolUseId}%`) as Row | undefined;
      if (row === undefined) return null;
      markReadStmt.run(Date.now(), row.id);
      return rowToItem({ ...row, read_at: Date.now() });
    },
    markReadByApprovalId(approvalId) {
      const row = db
        .prepare(`SELECT * FROM inbox_items WHERE approval_id = ? AND read_at IS NULL LIMIT 1`)
        .get(approvalId) as Row | undefined;
      if (row === undefined) return null;
      markReadStmt.run(Date.now(), row.id);
      return rowToItem({ ...row, read_at: Date.now() });
    },
  };
};
