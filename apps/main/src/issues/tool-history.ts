import type Database from "better-sqlite3";
import type { ToolCallRef } from "@dashboard-agent/shared";

type EventRow = { kind: string; payload_json: string; created_at: number };
type MsgRow = { tool_calls_json: string | null; created_at: number };
type Window = { start: number; end: number };

const computeDoingWindows = (events: EventRow[]): Window[] => {
  const windows: Window[] = [];
  let openStart: number | null = null;
  for (const e of events) {
    if (e.kind !== "status_changed") continue;
    const payload = JSON.parse(e.payload_json) as { from: string; to: string };
    if (payload.to === "doing" && openStart === null) {
      openStart = e.created_at;
    } else if (
      openStart !== null &&
      (payload.to === "review" || payload.to === "done" || payload.to === "cancelled")
    ) {
      windows.push({ start: openStart, end: e.created_at });
      openStart = null;
    }
  }
  if (openStart !== null) windows.push({ start: openStart, end: Number.MAX_SAFE_INTEGER });
  return windows;
};

export const getToolHistory = (db: Database.Database, issueId: string): ToolCallRef[] => {
  const issue = db.prepare("SELECT assignee_id FROM issues WHERE id = ?").get(issueId) as
    | { assignee_id: string | null }
    | undefined;
  if (issue === undefined || issue.assignee_id === null) return [];

  const events = db
    .prepare(
      "SELECT kind, payload_json, created_at FROM issue_events WHERE issue_id = ? ORDER BY created_at ASC",
    )
    .all(issueId) as EventRow[];
  const windows = computeDoingWindows(events);
  if (windows.length === 0) return [];

  const out: ToolCallRef[] = [];
  for (const w of windows) {
    // Use a 100 ms tolerance on the window-end so that messages inserted
    // just before the close event are still captured even when Date.now()
    // has coarse resolution (Windows: ~15 ms tick).
    const windowEnd = w.end === Number.MAX_SAFE_INTEGER ? w.end : w.end + 100;
    const msgs = db
      .prepare(
        "SELECT tool_calls_json, created_at FROM messages WHERE sender_kind = 'agent' AND sender_id = ? AND tool_calls_json IS NOT NULL AND created_at >= ? AND created_at <= ? ORDER BY created_at ASC",
      )
      .all(issue.assignee_id, w.start, windowEnd) as MsgRow[];
    for (const m of msgs) {
      if (m.tool_calls_json === null) continue;
      const calls = JSON.parse(m.tool_calls_json) as Array<{
        name: string;
        input: Record<string, unknown>;
      }>;
      for (const c of calls)
        out.push({ toolName: c.name, input: c.input, createdAt: m.created_at });
    }
  }
  return out;
};
