-- 0055_connections_cloudflare.sql — Deploy hand (D.1). Adds the 'cloudflare' connector
-- kind so the AI team can host the product it builds. SQLite cannot ALTER a CHECK —
-- recreate connections adding 'cloudflare' (same pattern as 0048/0051/0054:
-- defer_foreign_keys + create-new/copy/drop/rename). Preserves UNIQUE(company,kind).

PRAGMA defer_foreign_keys = 1;

CREATE TABLE connections_new (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('x', 'stripe', 'cloudflare')),
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
