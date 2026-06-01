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
const MCP_ALLOWLIST = new Set([
  "isa_read",
  "telos_read",
  "skill_read",
  "memory_read",
  "read_thread",
  "check_status",
  "list_pending_requests",
  "x_insights_read",
  "stripe_sales_read",
  "deployment_status",
]);

// MCP tools come through with the `mcp__<server>__` prefix (e.g.
// `mcp__dashboard__list_agents`). The pre-prefix code never matched the
// allowlist or the `list_` heuristic, so every MCP-namespaced read-only call
// fell into the supervised request_user branch — surfaced by p6 Task 0 in the
// installed app (memory: project_p6_task0_runtime_bugs_diagnosis).
const stripMcpPrefix = (name: string): string => {
  if (!name.startsWith("mcp__")) return name;
  const parts = name.split("__");
  return parts.length >= 3 ? parts.slice(2).join("__") : name;
};

export const isReadOnlyTool = (toolName: string): boolean => {
  if (toolName.length === 0) return false;
  if (BUILTIN_READ_ONLY.has(toolName)) return true;
  const bare = stripMcpPrefix(toolName);
  if (MCP_ALLOWLIST.has(bare)) return true;
  // list_* tools are by convention read-only (M5 / M11).
  if (bare.startsWith("list_")) return true;
  return false;
};
