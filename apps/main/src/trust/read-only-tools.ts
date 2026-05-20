// M14 PR-A — classifier used by the trust ladder gate rule. Read-only means
// "no side effect on disk, DB, network, or other agents". A non-read-only
// call NEVER becomes trust-auto-approved — that path is reserved for the
// Run Policy in auto mode (degrau autônomo).
//
// Conservative by default: an unknown tool is NOT read-only. New MCP tools
// must opt in explicitly.

// Built-in Claude tools that don't mutate state.
const BUILTIN_READ_ONLY = new Set(["Read", "Glob", "Grep"]);

// MCP tools explicitly allowlisted (don't match list_/_read patterns by
// coincidence or have a non-obvious name).
const MCP_ALLOWLIST = new Set(["isa_read", "telos_read", "skill_read", "memory_read"]);

export const isReadOnlyTool = (toolName: string): boolean => {
  if (toolName.length === 0) return false;
  if (BUILTIN_READ_ONLY.has(toolName)) return true;
  if (MCP_ALLOWLIST.has(toolName)) return true;
  // list_* tools are by convention read-only (M5 / M11).
  if (toolName.startsWith("list_")) return true;
  return false;
};
