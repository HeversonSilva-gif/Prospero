import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Filesystem layout for per-agent instruction bundles. Mirrors the M11
// memory-dir.ts pattern: everything under app.getPath("userData"). The bundle
// is a plain directory — no DB table — so the filesystem is the single source
// of truth (listFiles = readdir, add = write, delete = unlink).

// The entry file of every bundle. Concatenated first; never deletable.
export const ENTRY_FILENAME = "charter.md";

// Per-agent bundle directory:
//   <userData>/agent-instructions/companies/<companyId>/agents/<agentId>/
// Created on access.
export const getAgentInstructionsDir = (
  userDataDir: string,
  companyId: string,
  agentId: string,
): string => {
  const dir = join(userDataDir, "agent-instructions", "companies", companyId, "agents", agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// Rejects any filename that is not a safe, flat, markdown name. All instruction
// filenames are either the fixed entry or user-supplied via the Instructions
// tab, so this is the path-traversal guard for that input.
export const assertSafeFilename = (filename: string): void => {
  if (!/^[a-z0-9][a-z0-9-]*\.md$/i.test(filename)) {
    throw new Error(`unsafe instruction filename: ${JSON.stringify(filename)}`);
  }
};

// Absolute path of one file inside an agent's bundle. Pure — does not create
// directories. Guards the filename before joining.
export const instructionFilePath = (
  userDataDir: string,
  companyId: string,
  agentId: string,
  filename: string,
): string => {
  assertSafeFilename(filename);
  return join(getAgentInstructionsDir(userDataDir, companyId, agentId), filename);
};
