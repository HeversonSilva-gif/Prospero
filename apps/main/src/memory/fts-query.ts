// Shared FTS5 query escaper used by both the IPC learning handlers and
// the MCP memory-search tool.
//
// Turns raw search-box input into a safe FTS5 MATCH expression: each
// whitespace-separated term is wrapped in double quotes (so special
// characters can never break the query), and the quoted terms are joined
// by spaces, which FTS5 reads as an implicit AND.  Returns "" for blank
// input.
export const toFtsMatchExpr = (raw: string): string =>
  raw
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" ");
