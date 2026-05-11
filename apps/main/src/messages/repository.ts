import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Message, SenderKind, ToolCallView } from "@dashboard-agent/shared";
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
  tool_calls_json: string | null;
  created_at: number;
};

const rowToMessage = (r: MessageRow): Message => ({
  id: r.id,
  threadId: r.thread_id,
  senderKind: r.sender_kind as SenderKind,
  senderId: r.sender_id,
  content: r.content,
  toolCalls: r.tool_calls_json === null ? null : (JSON.parse(r.tool_calls_json) as ToolCallView[]),
  createdAt: r.created_at,
});

export type AppendInput = {
  companyId: string;
  participants: string[];
  senderKind: SenderKind;
  senderId: string | null;
  content: string;
  toolCalls?: ToolCallView[] | null;
};

export type AppendToThreadIdInput = {
  threadId: string;
  senderKind: SenderKind;
  senderId: string | null;
  content: string;
  toolCalls?: ToolCallView[] | null;
};

export type MessagesRepository = {
  ensureThread(companyId: string, participants: string[]): { id: string };
  append(input: AppendInput): Message;
  appendToThreadId(input: AppendToThreadIdInput): Message;
  list(threadId: string): Message[];
  listByParticipants(companyId: string, participants: string[]): Message[];
  listByAgentParticipating(agentId: string): Message[];
};

export const createMessagesRepository = (db: Database.Database): MessagesRepository => {
  const findThread = db.prepare(
    "SELECT id, company_id, participants_json, created_at FROM threads WHERE company_id = ? AND participants_json = ?",
  );
  const insertThread = db.prepare(
    "INSERT INTO threads (id, company_id, participants_json, created_at) VALUES (?, ?, ?, ?)",
  );
  const insertMessage = db.prepare(
    "INSERT INTO messages (id, thread_id, sender_kind, sender_id, content, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const listByThread = db.prepare(
    "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC",
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
      const toolCallsJson =
        input.toolCalls === null || input.toolCalls === undefined
          ? null
          : JSON.stringify(input.toolCalls);
      insertMessage.run(
        id,
        thread.id,
        input.senderKind,
        input.senderId,
        input.content,
        toolCallsJson,
        now,
      );
      return {
        id,
        threadId: thread.id,
        senderKind: input.senderKind,
        senderId: input.senderId,
        content: input.content,
        toolCalls: input.toolCalls ?? null,
        createdAt: now,
      };
    },
    appendToThreadId(input) {
      const id = `msg_${randomUUID()}`;
      const now = Date.now();
      const toolCallsJson =
        input.toolCalls === null || input.toolCalls === undefined
          ? null
          : JSON.stringify(input.toolCalls);
      insertMessage.run(
        id,
        input.threadId,
        input.senderKind,
        input.senderId,
        input.content,
        toolCallsJson,
        now,
      );
      return {
        id,
        threadId: input.threadId,
        senderKind: input.senderKind,
        senderId: input.senderId,
        content: input.content,
        toolCalls: input.toolCalls ?? null,
        createdAt: now,
      };
    },
    list(threadId) {
      const rows = listByThread.all(threadId) as MessageRow[];
      return rows.map(rowToMessage);
    },
    listByParticipants(companyId, participants) {
      const thread = findThread.get(companyId, threadKey(participants)) as ThreadRow | undefined;
      if (!thread) return [];
      const rows = listByThread.all(thread.id) as MessageRow[];
      return rows.map(rowToMessage);
    },
    listByAgentParticipating(agentId) {
      const rows = db
        .prepare(
          `SELECT m.*, t.participants_json AS t_participants_json FROM messages m
           JOIN threads t ON m.thread_id = t.id
           WHERE t.participants_json LIKE ?
           ORDER BY m.created_at ASC, m.id ASC`,
        )
        .all(`%${agentId}%`) as Array<MessageRow & { t_participants_json: string }>;
      // `participants_json` is misleadingly named — threadKey stores a sorted,
      // pipe-joined string ("agent_x|user"), not actual JSON. Split on `|`.
      return rows.map((r) => ({
        ...rowToMessage(r),
        threadParticipants: r.t_participants_json.split("|"),
      }));
    },
  };
};
