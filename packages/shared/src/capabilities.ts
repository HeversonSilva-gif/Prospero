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
  | "delegation"
  | "fs-read"
  | "fs-write"
  | "inbox"
  | "issues"
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
    description: "Hire/fire/message other agents; list active agents; read threads.",
    tools: [
      "mcp__dashboard__hire_agent",
      "mcp__dashboard__fire_agent",
      "mcp__dashboard__list_agents",
      "mcp__dashboard__message_agent",
      "mcp__dashboard__read_thread",
    ],
  },
  issues: {
    id: "issues",
    description: "Create, update, assign, list issues; check status.",
    tools: [
      "mcp__dashboard__create_issue",
      "mcp__dashboard__update_issue",
      "mcp__dashboard__assign_issue",
      "mcp__dashboard__list_issues",
      "mcp__dashboard__check_status",
    ],
  },
  inbox: {
    id: "inbox",
    description: "Notify or report to the user via the inbox.",
    tools: ["mcp__dashboard__notify_user", "mcp__dashboard__report_to_user"],
  },
  chat: {
    id: "chat",
    description: "Permission prompt routing — required for filesystem gate to function.",
    tools: ["mcp__dashboard__request_permission"],
  },
};

// Force-adds the 'chat' capability (needed for --permission-prompt-tool to
// work) if it's missing. Returns a new array; does not mutate input.
export const ensureChatCapability = (capabilities: string[]): string[] => {
  if (capabilities.includes("chat")) return [...capabilities];
  return [...capabilities, "chat"];
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
  return capabilitiesToTools(ensureChatCapability(capabilities));
};
