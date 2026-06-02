#!/usr/bin/env node
// Reports the heaviest MCP tool outputs from tool_output_metrics.
// Usage: node apps/main/scripts/tokenjuice-report.cjs <path-to-app.db>
const Database = require("better-sqlite3");

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node tokenjuice-report.cjs <path-to-app.db>");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const rows = db
  .prepare(
    `SELECT tool_name,
            COUNT(*)              AS calls,
            SUM(raw_chars)        AS total_raw,
            CAST(AVG(raw_chars) AS INTEGER) AS avg_raw,
            MAX(raw_chars)        AS max_raw,
            SUM(est_tokens_saved) AS tokens_saved
     FROM tool_output_metrics
     GROUP BY tool_name
     ORDER BY total_raw DESC`,
  )
  .all();

console.table(rows);
db.close();
