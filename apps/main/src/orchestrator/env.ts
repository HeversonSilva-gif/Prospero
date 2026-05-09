import { randomBytes } from "node:crypto";
import type { Agent } from "@dashboard-agent/shared";

export type SpawnEnv = {
  CLAUDE_CODE_OAUTH_TOKEN: string;
  AGENT_ID: string;
  COMPANY_ID: string;
  MCP_TOKEN: string;
};

export const buildSpawnEnv = (agent: Agent, oauthToken: string): SpawnEnv => ({
  CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
  AGENT_ID: agent.id,
  COMPANY_ID: agent.companyId,
  MCP_TOKEN: randomBytes(32).toString("hex"),
});
