import { join } from "node:path";

// Per-agent sandbox CWD. The agent spawns inside this empty directory, so tools that
// operate on CWD (ls, pwd, cat README.md) cannot leak project files even if the agent
// has misconfigured allowedProjects. Real project work requires absolute paths, which
// the security gate validates against allowedProjectPaths.
export const getAgentSandboxCwd = (userDataDir: string, agentId: string): string =>
  join(userDataDir, "agent-sandbox", agentId, "cwd");

export const getAgentConfigDir = (userDataDir: string, agentId: string): string =>
  join(userDataDir, "agent-sandbox", agentId);
