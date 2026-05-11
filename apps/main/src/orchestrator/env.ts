import type { Agent } from "@dashboard-agent/shared";

export type SpawnEnv = {
  CLAUDE_CODE_OAUTH_TOKEN: string;
  AGENT_ID: string;
  COMPANY_ID: string;
  DB_PATH: string;
  PERMISSIONS_DIR: string;
  EVENTS_DIR: string;
};

export const buildSpawnEnv = (
  agent: Agent,
  oauthToken: string,
  dbPath: string,
  permissionsDir: string,
  eventsDir: string,
): SpawnEnv => ({
  CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
  AGENT_ID: agent.id,
  COMPANY_ID: agent.companyId,
  DB_PATH: dbPath,
  PERMISSIONS_DIR: permissionsDir,
  EVENTS_DIR: eventsDir,
});
