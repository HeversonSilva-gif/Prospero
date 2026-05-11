import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Dir where MCP child processes drop event files (agent.deliver, agent.kill,
// agent.spawn-needed, issue.created, issue.updated). The orchestrator watches
// this dir and dispatches events. File-based instead of stderr because Claude
// CLI does not reliably forward MCP-child stderr to its own stderr on Windows.
export const getEventsDir = (userDataDir: string): string => {
  const dir = join(userDataDir, "agent-events");
  mkdirSync(dir, { recursive: true });
  return dir;
};
