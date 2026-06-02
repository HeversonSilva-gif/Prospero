import type Database from "better-sqlite3";
import { createInboxRepository } from "../inbox/repository.js";

const DEDUP_WINDOW_MS = 60 * 60 * 1000;

export interface GuardrailAlertArgs {
  companyId: string;
  actorId: string; // agentId, or a sentinel like "guardrails" for content alerts
  title: string;
  preview: string;
}

// Creates a deduped `security_alert` inbox row. Returns true if a row was created,
// false if a recent unread one already existed (so the caller can skip broadcasting).
// DB-only and fail-open: never throws.
export const createGuardrailAlert = (db: Database.Database, args: GuardrailAlertArgs): boolean => {
  try {
    const repo = createInboxRepository(db);
    const existing = repo.findRecentUnread({
      companyId: args.companyId,
      agentId: args.actorId,
      kind: "security_alert",
      withinMs: DEDUP_WINDOW_MS,
    });
    if (existing !== null) return false;
    // Disable FK enforcement for this insert: this helper runs in both the main
    // process and the MCP child process. In the child, referential integrity is
    // maintained by the main process; the DB write itself can proceed safely even
    // without a matching companies/agents row visible in the child's DB view.
    db.pragma("foreign_keys = OFF");
    try {
      repo.create({
        companyId: args.companyId,
        kind: "security_alert",
        actorId: args.actorId,
        title: args.title,
        preview: args.preview,
        requiresAction: false,
      });
    } finally {
      db.pragma("foreign_keys = ON");
    }
    return true;
  } catch (err) {
    console.warn("[guardrails] createGuardrailAlert failed", err);
    return false;
  }
};
