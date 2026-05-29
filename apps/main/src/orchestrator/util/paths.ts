import { join } from "node:path";

// Deterministic short id for the per-agent sandbox dir. Agent UUIDs look like
// "agent_2754ee4b-0121-4b84-a3a0-47673d37493f"; the full string under a deep
// path overflows Windows MAX_PATH when Claude encodes the CWD into a dir name
// (v0.1.38 PDF fix). Strip the "agent_" prefix + dashes and take the first 12
// hex chars (48 bits — collision-safe for any realistic agent count). Same
// agent → same slug, so --resume session dirs are stable.
export const shortAgentSlug = (agentId: string): string =>
  agentId
    .replace(/^agent_/, "")
    .replace(/-/g, "")
    .slice(0, 12);

// Per-agent sandbox CWD. The agent spawns inside this empty directory, so tools that
// operate on CWD (ls, pwd, cat README.md) cannot leak project files even if the agent
// has misconfigured allowedProjects. Real project work requires absolute paths, which
// the security gate validates against allowedProjectPaths.
export const getAgentSandboxCwd = (userDataDir: string, agentId: string): string =>
  join(userDataDir, "agent-sandbox", agentId, "cwd");

export const getAgentConfigDir = (userDataDir: string, agentId: string): string =>
  join(userDataDir, "agent-sandbox", agentId);
