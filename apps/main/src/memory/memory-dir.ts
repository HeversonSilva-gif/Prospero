import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Root of all M11 memory/skill markdown files. Lives under userData/ next to
// prospero.db, agent-events/, permissions/. Mirrors the getEventsDir pattern.
export const getMemoryRootDir = (userDataDir: string): string => {
  const dir = join(userDataDir, "memory");
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Per-company directory: holds memory.md + company-shared skills/.
export const getCompanyMemoryDir = (userDataDir: string, companyId: string): string => {
  const dir = join(getMemoryRootDir(userDataDir), "companies", companyId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Per-agent directory: holds the agent's memory.md + agent-private skills/.
export const getAgentMemoryDir = (
  userDataDir: string,
  companyId: string,
  agentId: string,
): string => {
  const dir = join(getCompanyMemoryDir(userDataDir, companyId), "agents", agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// SKILL.md path for a named skill inside a given scope directory (company or
// agent). Pure — does not create directories; the skill writer (PR-C) does.
export const skillBodyPath = (scopeDir: string, skillName: string): string =>
  join(scopeDir, "skills", skillName, "SKILL.md");
