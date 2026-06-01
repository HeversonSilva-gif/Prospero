-- 0056_connections_email.sql — Email hand (E.1). Adds the 'email' connector kind so the
-- AI team can deliver to buyers and reply to customers. SQLite cannot ALTER a CHECK —
-- recreate connections adding 'email' (same pattern as 0048/0051/0054/0055).

PRAGMA defer_foreign_keys = 1;

CREATE TABLE connections_new (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('x', 'stripe', 'cloudflare', 'email')),
  ciphertext TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (company_id, kind)
);

INSERT INTO connections_new
  (id, company_id, kind, ciphertext, metadata_json, created_at, updated_at)
SELECT id, company_id, kind, ciphertext, metadata_json, created_at, updated_at
FROM connections;

DROP TABLE connections;
ALTER TABLE connections_new RENAME TO connections;
CREATE INDEX idx_connections_company ON connections(company_id);
