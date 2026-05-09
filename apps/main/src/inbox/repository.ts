import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { InboxItem, InboxKind } from "@dashboard-agent/shared";

type Row = {
  id: string;
  company_id: string;
  kind: string;
  actor_id: string | null;
  title: string;
  preview: string | null;
  payload_json: string | null;
  requires_action: number;
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
  requiresAction: r.requires_action === 1,
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
};

export type InboxRepository = {
  create(input: CreateInboxInput): InboxItem;
  listByCompany(companyId: string): InboxItem[];
};

export const createInboxRepository = (db: Database.Database): InboxRepository => {
  const insert = db.prepare(`
    INSERT INTO inbox_items (id, company_id, kind, actor_id, title, preview, payload_json, requires_action, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)
  `);
  const list = db.prepare(
    "SELECT * FROM inbox_items WHERE company_id = ? ORDER BY created_at DESC",
  );

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
        input.requiresAction === true ? 1 : 0,
        now,
      );
      return {
        id,
        companyId: input.companyId,
        kind: input.kind,
        actorId: input.actorId ?? null,
        title: input.title,
        preview: input.preview ?? null,
        requiresAction: input.requiresAction === true,
        readAt: null,
        createdAt: now,
      };
    },
    listByCompany(companyId) {
      const rows = list.all(companyId) as Row[];
      return rows.map(rowToItem);
    },
  };
};
