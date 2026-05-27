// MCP orchestration tools that ARE the agent's decision/communication
// channel. In supervised mode, requiring approval for these creates circular
// deadlocks — most acutely with `decide_request`: the CEO's call to approve
// somebody else's request itself becomes an approval routed to the user, and
// the CEO freezes in `tool_use` waiting for its own answer. Evidence and
// timeline live in memory: project_p6_task0_runtime_bugs_diagnosis.
//
// Conservative by default: only tools that move orchestration state
// (decisions, messages, notifications) and never touch project files or
// destructive org actions are on this list. `hire_agent`, `fire_agent`,
// `create_issue`, `update_issue`, `assign_issue`, `record_artifact`,
// `criterion_judge` stay gated.

const META_TOOLS = new Set([
  "decide_request",
  "request_decision",
  "request_permission",
  "message_agent",
  "notify_user",
  "report_to_user",
]);

const stripMcpPrefix = (name: string): string => {
  if (!name.startsWith("mcp__")) return name;
  const parts = name.split("__");
  return parts.length >= 3 ? parts.slice(2).join("__") : name;
};

export const isMetaOrchestrationTool = (toolName: string): boolean => {
  if (toolName.length === 0) return false;
  return META_TOOLS.has(stripMcpPrefix(toolName));
};
