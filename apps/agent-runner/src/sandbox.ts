import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Default container location for per-agent state. */
export const AGENT_STATE_ROOT = "/var/lib/agent-state";

export type AgentSandbox = {
  /** CLAUDE_CONFIG_DIR for the agent — isolated settings, no host config. */
  configDir: string;
  /** Working directory the agent runs in. */
  workDir: string;
};

// Mirrors the host adapter's writeSandboxSettings: filesystem tools route
// through --permission-prompt-tool (ask); the dashboard MCP tools are pre-allowed.
const SANDBOX_SETTINGS = {
  permissions: {
    ask: ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "MultiEdit", "NotebookEdit"],
    allow: [
      "mcp__dashboard__list_agents",
      "mcp__dashboard__list_projects",
      "mcp__dashboard__hire_agent",
      "mcp__dashboard__fire_agent",
      "mcp__dashboard__message_agent",
      "mcp__dashboard__report_to_user",
      "mcp__dashboard__notify_user",
      "mcp__dashboard__create_issue",
      "mcp__dashboard__read_thread",
      "mcp__dashboard__update_issue",
      "mcp__dashboard__assign_issue",
      "mcp__dashboard__list_issues",
      "mcp__dashboard__check_status",
      "mcp__dashboard__request_permission",
    ],
  },
};

/**
 * Creates the per-agent config and work directories inside the container and
 * writes the sandbox settings.json. `root` is injectable for tests.
 */
export const prepareAgentSandbox = (
  agentId: string,
  root: string = AGENT_STATE_ROOT,
): AgentSandbox => {
  const base = join(root, agentId);
  const configDir = join(base, "config");
  const workDir = join(base, "work");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify(SANDBOX_SETTINGS, null, 2),
    "utf8",
  );
  return { configDir, workDir };
};
