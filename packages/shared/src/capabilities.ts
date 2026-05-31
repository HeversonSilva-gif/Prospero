// Canonical capability IDs and their resolved Claude tool sets. Modifying this
// file changes what each agent CAN see (the --allowedTools whitelist at spawn
// time). New built-in tools added to Claude CLI must be categorized into a
// capability here — the test "every built-in tool in KNOWN_CLAUDE_TOOLS is
// mapped" enforces this.

// Master list of built-in Claude tools we know about. Kept manually — when
// Claude CLI adds a new tool, add it here AND map it into a capability below.
// Tools internal to the CLI (TodoWrite, ExitPlanMode, etc.) are not listed
// because agents don't need them; they're used by claude itself.
export const KNOWN_CLAUDE_TOOLS = [
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "NotebookEdit",
  "Read",
  "WebFetch",
  "WebSearch",
  "Write",
] as const;

export type CapabilityId =
  | "chat"
  | "connectors"
  | "delegation"
  | "fs-read"
  | "fs-write"
  | "inbox"
  | "issues"
  | "memory"
  | "shell"
  | "web";

export type CapabilityDef = {
  id: CapabilityId;
  description: string;
  tools: string[];
};

export const CAPABILITY_CATALOG: Record<CapabilityId, CapabilityDef> = {
  shell: {
    id: "shell",
    description: "Run shell commands via Bash.",
    tools: ["Bash"],
  },
  "fs-read": {
    id: "fs-read",
    description: "Read files, search by glob, search content.",
    tools: ["Read", "Glob", "Grep"],
  },
  "fs-write": {
    id: "fs-write",
    description: "Edit, create, and modify files.",
    tools: ["Edit", "Write", "NotebookEdit"],
  },
  web: {
    id: "web",
    description: "Fetch URLs and search the web.",
    tools: ["WebFetch", "WebSearch"],
  },
  delegation: {
    id: "delegation",
    description: "Hire/fire/message agents; design the org and goal plans; orchestrate execution.",
    tools: [
      "mcp__dashboard__hire_agent",
      "mcp__dashboard__fire_agent",
      "mcp__dashboard__list_agents",
      "mcp__dashboard__message_agent",
      "mcp__dashboard__read_thread",
      // Org design (CEO architect) + role library reads.
      "mcp__dashboard__submit_org_plan",
      "mcp__dashboard__submit_business_plan",
      "mcp__dashboard__list_role_templates",
      // Goal planning + execution (M8.5). Without these the planning CEO hit the
      // permission gate on every call and froze.
      "mcp__dashboard__submit_goal_plan",
      "mcp__dashboard__get_goal",
      "mcp__dashboard__list_goals",
      "mcp__dashboard__update_goal_status",
      "mcp__dashboard__record_subgoal",
      "mcp__dashboard__finalize_goal_execution",
      "mcp__dashboard__create_issue_for_plan",
      "mcp__dashboard__hire_agent_for_plan",
      // Manager approval system: the CEO decides/queues other agents' requests.
      "mcp__dashboard__decide_request",
      "mcp__dashboard__list_pending_requests",
    ],
  },
  issues: {
    id: "issues",
    description: "Create, update, assign, comment, list issues; projects; verification; artifacts.",
    tools: [
      "mcp__dashboard__create_issue",
      "mcp__dashboard__update_issue",
      "mcp__dashboard__assign_issue",
      "mcp__dashboard__list_issues",
      "mcp__dashboard__check_status",
      "mcp__dashboard__comment_on_issue",
      "mcp__dashboard__list_projects",
      "mcp__dashboard__record_artifact",
      // Verification (M13) + cost baseline reads.
      "mcp__dashboard__criterion_check",
      "mcp__dashboard__criterion_judge",
      "mcp__dashboard__get_cost_baseline",
    ],
  },
  inbox: {
    id: "inbox",
    description: "Notify or report to the user via the inbox.",
    tools: ["mcp__dashboard__notify_user", "mcp__dashboard__report_to_user"],
  },
  chat: {
    id: "chat",
    description:
      "Base agent comms: permission-prompt routing (required for the filesystem gate) " +
      "and asking the manager (CEO) for a decision. Force-added to every agent.",
    tools: ["mcp__dashboard__request_permission", "mcp__dashboard__request_decision"],
  },
  memory: {
    id: "memory",
    description:
      "Read/write the agent's memory and skills; search past sessions; read company TELOS/ISA.",
    tools: [
      "mcp__dashboard__skill_search",
      "mcp__dashboard__skill_read",
      "mcp__dashboard__skill_create",
      "mcp__dashboard__skill_update",
      "mcp__dashboard__skill_promote",
      "mcp__dashboard__memory_read",
      "mcp__dashboard__memory_add",
      "mcp__dashboard__memory_remove",
      "mcp__dashboard__memory_search",
      "mcp__dashboard__session_search",
      // Universal company-context reads (M13) — memory is force-added to every
      // agent, so every agent can read the TELOS/ISA it is accountable to.
      "mcp__dashboard__isa_read",
      "mcp__dashboard__telos_read",
      // Project context distillation (Phase 2) — agents read/annotate the digest.
      "mcp__dashboard__project_context_read",
      "mcp__dashboard__project_context_note",
    ],
  },
  connectors: {
    id: "connectors",
    description:
      "Publish on the company's connected external accounts (X): post a tweet, reply to a tweet. " +
      "Each publish is gated for approval first (graduates to automatic via trust tiers).",
    tools: [
      "mcp__dashboard__post_to_x",
      "mcp__dashboard__reply_on_x",
      "mcp__dashboard__x_insights_read",
    ],
  },
};

// Force-adds the 'chat' capability (needed for --permission-prompt-tool to
// work) if it's missing. Returns a new array; does not mutate input.
export const ensureChatCapability = (capabilities: string[]): string[] => {
  if (capabilities.includes("chat")) return [...capabilities];
  return [...capabilities, "chat"];
};

// Force-adds the 'memory' capability — the M11 learning loop must be available
// to every agent regardless of role. Returns a new array; does not mutate input.
export const ensureMemoryCapability = (capabilities: string[]): string[] => {
  if (capabilities.includes("memory")) return [...capabilities];
  return [...capabilities, "memory"];
};

// Translates capability IDs into the flat deduplicated list of Claude tool
// names. Unknown capability IDs are silently dropped (logged elsewhere if
// needed) so a stale capabilities_json from a future version doesn't crash
// spawn.
export const capabilitiesToTools = (capabilities: string[]): string[] => {
  const out = new Set<string>();
  for (const id of capabilities) {
    const def = CAPABILITY_CATALOG[id as CapabilityId];
    if (def === undefined) continue;
    for (const t of def.tools) out.add(t);
  }
  return Array.from(out);
};

// Full resolver: ensures the chat safety-net and returns the flat tool list.
// This is the function the orchestrator should call when building spawn args.
export const resolveCapabilityTools = (capabilities: string[]): string[] => {
  return capabilitiesToTools(ensureMemoryCapability(ensureChatCapability(capabilities)));
};

// M12 PR-E2: Run Policy is a fine sub-toggle of the delegation/issues
// capabilities. It only ever *removes* tools from the resolved list — never
// adds. Applied after resolveCapabilityTools, at spawn time.
export const applyRunPolicy = (
  tools: string[],
  policy: { canHire: boolean; canAssign: boolean },
): string[] => {
  let out = tools;
  // These tool names MUST stay in sync with CAPABILITY_CATALOG (delegation /
  // issues entries). If a tool is renamed in the catalog, update them here too.
  if (!policy.canHire) {
    out = out.filter(
      (t) => t !== "mcp__dashboard__hire_agent" && t !== "mcp__dashboard__fire_agent",
    );
  }
  if (!policy.canAssign) {
    out = out.filter((t) => t !== "mcp__dashboard__assign_issue");
  }
  return out;
};
