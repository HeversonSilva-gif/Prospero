import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { CHARTER_SKELETON } from "@prospero/shared";
import { roleCharterDir, roleCharterPath } from "./role-library-dir.js";
import { SEED_CHARTERS } from "./seed-charters.js";

// Disk I/O for role charters. The on-disk file is the source of truth once it
// exists; SEED_CHARTERS is only the pristine default used to materialize a
// seed role's charter the first time it is read (copy-on-write).

// Writes a role's charter body, creating the role directory if needed.
export const writeCharter = (userDataDir: string, roleId: string, body: string): void => {
  roleCharterDir(userDataDir, roleId); // ensures the directory exists
  writeFileSync(roleCharterPath(userDataDir, roleId), body, "utf8");
};

// Reads a role's charter. If no file exists yet, it is materialized: from
// SEED_CHARTERS for the 5 shipped roles, or from CHARTER_SKELETON otherwise.
// The materialized body is written to disk so subsequent edits persist.
export const readCharter = (userDataDir: string, roleId: string): string => {
  const path = roleCharterPath(userDataDir, roleId);
  if (existsSync(path)) return readFileSync(path, "utf8");
  const body = SEED_CHARTERS[roleId] ?? CHARTER_SKELETON;
  writeCharter(userDataDir, roleId, body);
  return body;
};

// Removes a role's entire charter directory. Safe to call when nothing exists.
export const deleteCharterDir = (userDataDir: string, roleId: string): void => {
  const dir = roleCharterDir(userDataDir, roleId);
  rmSync(dir, { recursive: true, force: true });
};

// Copies the source role's charter to a destination role (used by clone).
export const copyCharter = (userDataDir: string, fromId: string, toId: string): void => {
  writeCharter(userDataDir, toId, readCharter(userDataDir, fromId));
};
