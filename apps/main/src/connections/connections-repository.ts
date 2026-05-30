import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// Encrypt/decrypt boundary. Injected so the repository stays electron-free and
// unit-testable; production passes a safeStorage-backed cipher (wired at the IPC
// layer, alongside the other electron imports). `encrypt` returns an opaque string
// (e.g. base64) safe to store; `decrypt` reverses it.
export type Cipher = {
  encrypt: (plain: string) => string;
  decrypt: (stored: string) => string;
};

// A stored external-account connection: SECRET tokens in `payload` (encrypted at
// rest), non-secret display info (e.g. @handle, account id, client id) in `metadata`.
export type Connection = {
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type ConnectionsRepository = {
  /** Upsert the connection for (company, kind): encrypts `payload`, stores `metadata` as-is. */
  save: (
    companyId: string,
    kind: string,
    payload: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) => void;
  /** Decrypts and returns the connection, or null if none. */
  load: (companyId: string, kind: string) => Connection | null;
  /** Non-secret metadata for every connection of a company (for status UI — no decrypt). */
  listMetadata: (companyId: string) => Array<{ kind: string; metadata: Record<string, unknown> }>;
  /** Removes the connection (disconnect). */
  clear: (companyId: string, kind: string) => void;
};

const parseMeta = (json: string | null): Record<string, unknown> =>
  json !== null ? (JSON.parse(json) as Record<string, unknown>) : {};

export const createConnectionsRepository = (
  db: Database.Database,
  cipher: Cipher,
): ConnectionsRepository => ({
  save(companyId, kind, payload, metadata = {}) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO connections (id, company_id, kind, ciphertext, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(company_id, kind) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).run(
      randomUUID(),
      companyId,
      kind,
      cipher.encrypt(JSON.stringify(payload)),
      JSON.stringify(metadata),
      now,
      now,
    );
  },
  load(companyId, kind) {
    const row = db
      .prepare(
        "SELECT ciphertext, metadata_json FROM connections WHERE company_id = ? AND kind = ?",
      )
      .get(companyId, kind) as { ciphertext: string; metadata_json: string | null } | undefined;
    if (row === undefined) return null;
    return {
      payload: JSON.parse(cipher.decrypt(row.ciphertext)) as Record<string, unknown>,
      metadata: parseMeta(row.metadata_json),
    };
  },
  listMetadata(companyId) {
    const rows = db
      .prepare("SELECT kind, metadata_json FROM connections WHERE company_id = ? ORDER BY kind")
      .all(companyId) as Array<{ kind: string; metadata_json: string | null }>;
    return rows.map((r) => ({ kind: r.kind, metadata: parseMeta(r.metadata_json) }));
  },
  clear(companyId, kind) {
    db.prepare("DELETE FROM connections WHERE company_id = ? AND kind = ?").run(companyId, kind);
  },
});
