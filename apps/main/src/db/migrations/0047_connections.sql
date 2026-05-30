-- 0047_connections.sql — External account connectors (0.2.X One Person Business, P1).
-- One row per (company, kind): OAuth/API tokens encrypted in `ciphertext`
-- (safeStorage, same pattern as auth.token), non-secret display info (e.g. @handle,
-- account id) in `metadata_json`. P1 ships the 'x' connector; 'stripe' lands in P5
-- (kind pre-allowed in the CHECK so no table recreate is needed later).
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('x', 'stripe')),
  ciphertext TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (company_id, kind)
);
CREATE INDEX idx_connections_company ON connections(company_id);
