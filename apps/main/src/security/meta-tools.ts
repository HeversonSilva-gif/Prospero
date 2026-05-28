// MCP orchestration tools that ARE the agent's decision/communication
// channel. In supervised mode, requiring approval for these creates circular
// deadlocks — most acutely with `decide_request` and `decide_batch`: the CEO's
// call to approve somebody else's request itself becomes an approval routed to
// the user, and the CEO freezes in `tool_use` waiting for its own answer.
// Evidence and timeline live in memory: project_p6_task0_runtime_bugs_diagnosis
// (decide_request) and the v0.1.29 follow-up (decide_batch was missing from
// this list when peça #5 added the coalescer, so every coalesced flush hung
// on user approval).
//
// `hire_agent` and `fire_agent` stay gated — they're the only irreversible
// org-shape mutations and warrant explicit human approval in supervised mode.
// Everything else operational (decide, record, comment, create/update/assign
// issues, judge criteria) auto-allows so the CEO can actually run the team.

const META_TOOLS = new Set([
  "decide_request",
  "decide_batch",
  "request_decision",
  "request_permission",
  "message_agent",
  "notify_user",
  "report_to_user",
  "record_artifact",
  "comment_on_issue",
  "create_issue",
  "update_issue",
  "assign_issue",
  "criterion_judge",
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
