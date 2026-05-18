import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Filesystem layout for authored role charters. Mirrors the M11 memory-dir.ts
// pattern: everything lives under app.getPath("userData") so the E2E
// PROSPERO_USER_DATA override and userData relocation both work. The charter
// path is fully derived from the roleId — no absolute path is stored in SQLite.

// Root of the role library: <userData>/role-library/
export const getRoleLibraryDir = (userDataDir: string): string => {
  const dir = join(userDataDir, "role-library");
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Guards a roleId before it is used as a path segment. All role ids are
// generated host-side ("role-ceo" for seeds, "role_<uuid>" for custom roles),
// so a value outside this shape means tampering — reject it.
export const assertSafeRoleId = (roleId: string): void => {
  if (!/^role[-_][A-Za-z0-9-]+$/.test(roleId)) {
    throw new Error(`unsafe role id: ${JSON.stringify(roleId)}`);
  }
};

// Per-role directory: <userData>/role-library/<roleId>/  (created on access).
export const roleCharterDir = (userDataDir: string, roleId: string): string => {
  assertSafeRoleId(roleId);
  const dir = join(getRoleLibraryDir(userDataDir), roleId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// charter.md path for a role. Pure — does not create the directory.
export const roleCharterPath = (userDataDir: string, roleId: string): string => {
  assertSafeRoleId(roleId);
  return join(getRoleLibraryDir(userDataDir), roleId, "charter.md");
};
