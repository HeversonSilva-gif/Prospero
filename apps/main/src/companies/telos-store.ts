// Disk I/O for a company's TELOS. The on-disk telos.md is the source of truth.
// Unlike the ISA (M13 PR-A), the TELOS is NOT lazily materialized — readTelos
// returns null when no file exists. A telos.md is created only when the user
// synthesizes or saves one via the /telos route.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getCompanyDir, companyTelosPath } from "./telos-dir.js";

// Returns the telos.md body, or null when the company has no TELOS yet.
export const readTelos = (userDataDir: string, companyId: string): string | null => {
  const path = companyTelosPath(userDataDir, companyId);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
};

// Writes the telos.md body, creating the company directory if needed.
export const writeTelos = (userDataDir: string, companyId: string, body: string): void => {
  getCompanyDir(userDataDir, companyId);
  writeFileSync(companyTelosPath(userDataDir, companyId), body, "utf8");
};

// Whether a company's telos.md has been authored.
export const telosExists = (userDataDir: string, companyId: string): boolean =>
  existsSync(companyTelosPath(userDataDir, companyId));
