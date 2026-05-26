import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Attachment, Message, MessageKind, SenderKind, ToolCallView } from "@prospero/shared";
import { threadKey } from "./thread-key.js";

type ThreadRow = {
  id: string;
  company_id: string;
  participants_json: string;
  created_at: number;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_kind: string;
  sender_id: string | null;
  content: string;
  kind: string;
  tool_calls_json: string | null;
  created_at: number;
};

// Joined row shape: one row per (message × attachment), with attachment columns
// nullable for messages that have no attachments (LEFT JOIN). Grouping by
// message id reconstructs Message[] with attachments[] populated.
type MessageAttachmentJoinRow = MessageRow & {
  att_id: string | null;
  att_message_id: string | null;
  att_filename: string | null;
  att_mime_type: string | null;
  att_size_bytes: number | null;
  att_created_at: number | null;
};

const MESSAGE_WITH_ATTACHMENTS_COLUMNS = `
  m.id, m.thread_id, m.sender_kind, m.sender_id, m.content, m.kind,
  m.tool_calls_json, m.created_at,
  ma.id AS att_id, ma.message_id AS att_message_id, ma.filename AS att_filename,
  ma.mime_type AS att_mime_type, ma.size_bytes AS att_size_bytes,
  ma.created_at AS att_created_at
`;

const rowToMessage = (r: MessageRow): Message => ({
  id: r.id,
  threadId: r.thread_id,
  senderKind: r.sender_kind as SenderKind,
  senderId: r.sender_id,
  content: r.content,
  kind: r.kind as MessageKind,
  toolCalls: r.tool_calls_json === null ? null : (JSON.parse(r.tool_calls_json) as ToolCallView[]),
  createdAt: r.created_at,
  attachments: [],
});

// Groups joined rows by message id (preserving the SQL ORDER BY) so each
// Message ends up with its attachments collected in upload order. Messages
// without any attachment row keep `attachments: []` (the LEFT JOIN yields a
// single row with `att_id IS NULL` — guarded below).
const groupJoinRows = (rows: MessageAttachmentJoinRow[]): Message[] => {
  const order: string[] = [];
  const map = new Map<string, Message>();
  for (const r of rows) {
    let msg = map.get(r.id);
    if (msg === undefined) {
      msg = rowToMessage(r);
      map.set(r.id, msg);
      order.push(r.id);
    }
    if (
      r.att_id !== null &&
      r.att_filename !== null &&
      r.att_mime_type !== null &&
      r.att_size_bytes !== null &&
      r.att_created_at !== null
    ) {
      const attachment: Attachment = {
        id: r.att_id,
        messageId: r.att_message_id,
        filename: r.att_filename,
        mimeType: r.att_mime_type,
        sizeBytes: r.att_size_bytes,
        createdAt: r.att_created_at,
      };
      msg.attachments = [...(msg.attachments ?? []), attachment];
    }
  }
  return order.map((id) => map.get(id) as Message);
};

export type AppendInput = {
  companyId: string;
  participants: string[];
  senderKind: SenderKind;
  senderId: string | null;
  content: string;
  kind?: MessageKind;
  toolCalls?: ToolCallView[] | null;
};

export type AppendToThreadIdInput = {
  threadId: string;
  senderKind: SenderKind;
  senderId: string | null;
  content: string;
  kind?: MessageKind;
  toolCalls?: ToolCallView[] | null;
};

export type MessagesRepository = {
  ensureThread(companyId: string, participants: string[]): { id: string };
  append(input: AppendInput): Message;
  appendToThreadId(input: AppendToThreadIdInput): Message;
  list(threadId: string): Message[];
  listByParticipants(companyId: string, participants: string[]): Message[];
  listByAgentParticipating(agentId: string): Message[];
  countUnansweredQuestions(agentId: string): number;
};

export const createMessagesRepository = (db: Database.Database): MessagesRepository => {
  const findThread = db.prepare(
    "SELECT id, company_id, participants_json, created_at FROM threads WHERE company_id = ? AND participants_json = ?",
  );
  const insertThread = db.prepare(
    "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES (?, ?, ?, ?)",
  );
  const insertMessage = db.prepare(
    "INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, kind, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertMessageFts = db.prepare(
    "INSERT INTO messages_fts (message_id, content) VALUES (?, ?)",
  );
  const listByThread = db.prepare(
    `SELECT ${MESSAGE_WITH_ATTACHMENTS_COLUMNS}
       FROM messages m
       LEFT JOIN message_attachments ma ON ma.message_id = m.id
       WHERE m.thread_id = ?
       ORDER BY m.created_at ASC, m.id ASC, ma.created_at ASC, ma.id ASC`,
  );

  const ensureThread = (companyId: string, participants: string[]): { id: string } => {
    const key = threadKey(participants);
    const existing = findThread.get(companyId, key) as ThreadRow | undefined;
    if (existing) return { id: existing.id };
    const id = `thr_${randomUUID()}`;
    insertThread.run(id, companyId, key, Date.now());
    return { id };
  };

  return {
    ensureThread,
    append(input) {
      const thread = ensureThread(input.companyId, input.participants);
      const id = `msg_${randomUUID()}`;
      const now = Date.now();
      const kind = input.kind ?? "message";
      const toolCallsJson =
        input.toolCalls === null || input.toolCalls === undefined
          ? null
          : JSON.stringify(input.toolCalls);
      const writeTx = db.transaction(() => {
        insertMessage.run(
          id,
          thread.id,
          input.senderKind,
          input.senderId,
          input.content,
          kind,
          toolCallsJson,
          now,
        );
        insertMessageFts.run(id, input.content);
      });
      writeTx();
      return {
        id,
        threadId: thread.id,
        senderKind: input.senderKind,
        senderId: input.senderId,
        content: input.content,
        kind,
        toolCalls: input.toolCalls ?? null,
        createdAt: now,
      };
    },
    appendToThreadId(input) {
      const id = `msg_${randomUUID()}`;
      const now = Date.now();
      const kind = input.kind ?? "message";
      const toolCallsJson =
        input.toolCalls === null || input.toolCalls === undefined
          ? null
          : JSON.stringify(input.toolCalls);
      const writeTx = db.transaction(() => {
        insertMessage.run(
          id,
          input.threadId,
          input.senderKind,
          input.senderId,
          input.content,
          kind,
          toolCallsJson,
          now,
        );
        insertMessageFts.run(id, input.content);
      });
      writeTx();
      return {
        id,
        threadId: input.threadId,
        senderKind: input.senderKind,
        senderId: input.senderId,
        content: input.content,
        kind,
        toolCalls: input.toolCalls ?? null,
        createdAt: now,
      };
    },
    list(threadId) {
      const rows = listByThread.all(threadId) as MessageAttachmentJoinRow[];
      return groupJoinRows(rows);
    },
    listByParticipants(companyId, participants) {
      const thread = findThread.get(companyId, threadKey(participants)) as ThreadRow | undefined;
      if (!thread) return [];
      const rows = listByThread.all(thread.id) as MessageAttachmentJoinRow[];
      return groupJoinRows(rows);
    },
    listByAgentParticipating(agentId) {
      const rows = db
        .prepare(
          `SELECT ${MESSAGE_WITH_ATTACHMENTS_COLUMNS},
                  t.participants_json AS t_participants_json
             FROM messages m
             JOIN threads t ON m.thread_id = t.id
             LEFT JOIN message_attachments ma ON ma.message_id = m.id
            WHERE t.participants_json LIKE ?
            ORDER BY m.created_at ASC, m.id ASC, ma.created_at ASC, ma.id ASC`,
        )
        .all(`%${agentId}%`) as Array<MessageAttachmentJoinRow & { t_participants_json: string }>;
      // `participants_json` is misleadingly named — threadKey stores a sorted,
      // pipe-joined string ("agent_x|user"), not actual JSON. Split on `|`.
      const grouped = groupJoinRows(rows);
      const participantsById = new Map<string, string[]>();
      for (const r of rows) {
        if (!participantsById.has(r.id)) {
          participantsById.set(r.id, r.t_participants_json.split("|"));
        }
      }
      return grouped.map((m) => ({
        ...m,
        threadParticipants: participantsById.get(m.id) ?? [],
      }));
    },
    countUnansweredQuestions(agentId) {
      // For each question this agent sent, check whether the same thread has a
      // later (or same-tick) message from anyone but this agent. Same-tick
      // matters because better-sqlite3 inserts often share Date.now() within a
      // millisecond — strict > would mark same-tick replies as unanswered.
      const rows = db
        .prepare(
          `SELECT m.id, m.thread_id, m.created_at
             FROM messages m
            WHERE m.sender_kind = 'agent'
              AND m.sender_id = ?
              AND m.kind = 'question'`,
        )
        .all(agentId) as Array<{ id: string; thread_id: string; created_at: number }>;
      let unanswered = 0;
      const replyCheck = db.prepare(
        `SELECT 1 FROM messages
          WHERE thread_id = ?
            AND id != ?
            AND created_at >= ?
            AND NOT (sender_kind = 'agent' AND sender_id = ?)
          LIMIT 1`,
      );
      for (const q of rows) {
        const replied = replyCheck.get(q.thread_id, q.id, q.created_at, agentId);
        if (replied === undefined) unanswered += 1;
      }
      return unanswered;
    },
  };
};
