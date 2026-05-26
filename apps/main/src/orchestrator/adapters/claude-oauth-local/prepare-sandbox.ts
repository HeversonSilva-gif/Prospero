import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentConfigDir, getAgentSandboxCwd } from "../../util/paths.js";

export type SandboxPaths = {
  agentConfigDir: string;
  agentSandboxCwd: string;
  isEphemeralConfigDir: boolean;
};

// Sandbox lockdown: point claude at a CLAUDE_CONFIG_DIR isolated from the host user's
// ~/.claude/ — no SessionStart hooks, no global MCP servers, no skills, no plugins, no
// slash commands. Combined with --strict-mcp-config in buildClaudeArgs, this enforces
// a real per-agent sandbox.
//
// Persistent dir when userDataDir given (production) — required for --resume across spawns.
// Ephemeral mkdtemp dir when omitted (tests).
export const prepareSandbox = (agentId: string, userDataDir: string | undefined): SandboxPaths => {
  if (userDataDir !== undefined) {
    const agentConfigDir = getAgentConfigDir(userDataDir, agentId);
    mkdirSync(agentConfigDir, { recursive: true });
    const agentSandboxCwd = getAgentSandboxCwd(userDataDir, agentId);
    mkdirSync(agentSandboxCwd, { recursive: true });
    return { agentConfigDir, agentSandboxCwd, isEphemeralConfigDir: false };
  }
  return {
    agentConfigDir: mkdtempSync(join(tmpdir(), "da-claude-cfg-")),
    agentSandboxCwd: mkdtempSync(join(tmpdir(), "da-agent-cwd-")),
    isEphemeralConfigDir: true,
  };
};

// claude reads OAuth Max token from <CLAUDE_CONFIG_DIR>/.credentials.json (keychain)
// and only falls back to env vars in --bare mode. The agent uses the same Anthropic
// account as the host (same machine, same OAuth Max), so we seed the sandbox keychain
// from the host's credentials. This intentionally shares the credential — but blocks
// everything else (hooks, skills, global MCP servers, projects, sessions, snapshots).
export const seedSandboxCredentials = (agentConfigDir: string): boolean => {
  const hostCreds = join(homedir(), ".claude", ".credentials.json");
  const sandboxCreds = join(agentConfigDir, ".credentials.json");
  if (!existsSync(hostCreds)) return false;
  try {
    copyFileSync(hostCreds, sandboxCreds);
    return true;
  } catch {
    // Caller logs; we swallow to avoid breaking spawn on credential read errors.
    return false;
  }
};

// Per-agent settings.json routes filesystem tools through --permission-prompt-tool
// (ask) and pre-allows our orchestration MCP tools (allow). Required because in
// stream-json non-interactive mode, --permission-prompt-tool only fires when claude
// is told to ask via permissions config, not by default.
export const writeSandboxSettings = (agentConfigDir: string): void => {
  const settingsPath = join(agentConfigDir, "settings.json");
  const settingsContent = {
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
  try {
    writeFileSync(settingsPath, JSON.stringify(settingsContent, null, 2), "utf8");
  } catch {
    // Caller logs; we swallow.
  }
};
