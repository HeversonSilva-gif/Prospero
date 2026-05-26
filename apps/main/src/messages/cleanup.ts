import { rmSync } from "node:fs";
import type Database from "better-sqlite3";

const PENDING_TTL_MS = 60 * 60 * 1000;

export const cleanupOrphanAttachments = (db: Database.Database): number => {
  const cutoff = Date.now() - PENDING_TTL_MS;
  const orphans = db
    .prepare(
      `SELECT id, local_path FROM message_attachments
       WHERE message_id IS NULL AND created_at < ?`,
    )
    .all(cutoff) as Array<{ id: string; local_path: string }>;

  for (const o of orphans) {
    try {
      rmSync(o.local_path, { force: true });
    } catch {
      // best-effort
    }
    db.prepare("DELETE FROM message_attachments WHERE id = ?").run(o.id);
  }
  return orphans.length;
};
