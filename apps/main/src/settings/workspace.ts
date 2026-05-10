import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_WORKSPACE_DIRNAME = "DashboardAgent-Workspace";

export const resolveWorkspaceCwd = (configured: string | null): string => {
  const path =
    configured === null || configured.trim() === ""
      ? join(homedir(), DEFAULT_WORKSPACE_DIRNAME)
      : configured;
  mkdirSync(path, { recursive: true });
  return path;
};
