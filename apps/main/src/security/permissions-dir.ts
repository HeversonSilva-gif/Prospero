import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const getPermissionsDir = (userDataDir: string): string => {
  const dir = join(userDataDir, "permissions");
  mkdirSync(dir, { recursive: true });
  return dir;
};
