import type Database from "better-sqlite3";
import { createInboxRepository } from "../inbox/repository.js";

const DEDUP_WINDOW_MS = 60 * 60 * 1000;

export interface GuardrailAlertArgs {
  companyId: string;
  // A real agent id (deduped per-agent), or null for content alerts not tied to one
  // agent. inbox_items.actor_id REFERENCES agents(id), so a non-null value MUST be a
  // real agent — use null otherwise (e.g. the email-content detector alert).
  actorId: string | null;
  title: string;
  preview: string;
}

// Creates a deduped `security_alert` inbox row. Returns true if a row was created,
// false if a recent unread one already existed (caller can skip broadcasting).
// DB-only and fail-open: never throws. No FK toggling — production always has a valid
// company; actorId is either a real agent or null.
export const createGuardrailAlert = (db: Database.Database, args: GuardrailAlertArgs): boolean => {
  try {
    const repo = createInboxRepository(db);
    if (args.actorId !== null) {
      // Dedup per-agent. findRecentUnread matches on actor_id and cannot match NULL,
      // so null-actor content alerts are intentionally not deduped here.
      const existing = repo.findRecentUnread({
        companyId: args.companyId,
        agentId: args.actorId,
        kind: "security_alert",
        withinMs: DEDUP_WINDOW_MS,
      });
      if (existing !== null) return false;
    }
    repo.create({
      companyId: args.companyId,
      kind: "security_alert",
      actorId: args.actorId,
      title: args.title,
      preview: args.preview,
      requiresAction: false,
    });
    return true;
  } catch (err) {
    console.warn("[guardrails] createGuardrailAlert failed", err);
    return false;
  }
};
