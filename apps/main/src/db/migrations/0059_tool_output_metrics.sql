-- 0059_tool_output_metrics.sql — TokenJuice Fase 1. Measures the size of each MCP tool
-- output (raw vs. after compression) to find the offenders worth shaping in Fase 2.
-- Stores SIZES ONLY — never payload content.
CREATE TABLE tool_output_metrics (
  id               TEXT PRIMARY KEY,
  company_id       TEXT,
  agent_id         TEXT,
  tool_name        TEXT NOT NULL,
  raw_chars        INTEGER NOT NULL,
  reduced_chars    INTEGER NOT NULL,
  est_tokens_saved INTEGER NOT NULL,
  mode             TEXT NOT NULL,
  clamped          INTEGER NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_tool_output_metrics_tool_created ON tool_output_metrics (tool_name, created_at);
