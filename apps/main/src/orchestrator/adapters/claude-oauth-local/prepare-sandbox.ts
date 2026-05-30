import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

// Default location of the host's OAuth credential file.
const hostCredentialsPath = (): string => join(homedir(), ".claude", ".credentials.json");

// Reads the OAuth access-token expiry (ms epoch) out of a .credentials.json, or
// null when the file is absent / unparseable / has no expiry. Used purely to
// compare freshness between the host file and a sandbox copy.
const readCredentialExpiry = (credsPath: string): number | null => {
  try {
    const parsed = JSON.parse(readFileSync(credsPath, "utf8")) as {
      claudeAiOauth?: { expiresAt?: unknown };
    };
    const exp = parsed.claudeAiOauth?.expiresAt;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
};

// claude reads OAuth Max token from <CLAUDE_CONFIG_DIR>/.credentials.json (keychain)
// and only falls back to env vars in --bare mode. The agent uses the same Anthropic
// account as the host (same machine, same OAuth Max), so we seed the sandbox keychain
// from the host's credentials. This intentionally shares the credential — but blocks
// everything else (hooks, skills, global MCP servers, projects, sessions, snapshots).
//
// NO-CLOBBER (refresh-token rotation safety): Anthropic ROTATES the refresh token
// on every refresh — the previous one is revoked. The sandboxed claude refreshes
// on its own and writes a NEWER credential into its CLAUDE_CONFIG_DIR, which also
// revokes the refresh token the host file still holds. Blindly copying the host
// file back over a fresher sandbox copy therefore hands the agent a now-revoked
// refresh token → it 401s and can't recover (the recurring loop fixed 2026-05-30).
// So we never DOWNGRADE: when we can prove the sandbox credential is strictly
// newer (both expiries known), keep it. Every ambiguous case reseeds from host,
// preserving the original behaviour. `hostCreds` is injectable for tests.
export const seedSandboxCredentials = (
  agentConfigDir: string,
  hostCreds: string = hostCredentialsPath(),
): boolean => {
  const sandboxCreds = join(agentConfigDir, ".credentials.json");
  if (!existsSync(hostCreds)) return false;
  if (existsSync(sandboxCreds)) {
    const hostExp = readCredentialExpiry(hostCreds);
    const sandboxExp = readCredentialExpiry(sandboxCreds);
    if (hostExp !== null && sandboxExp !== null && sandboxExp > hostExp) {
      return true; // sandbox already holds a fresher token — do not clobber it
    }
  }
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
