import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import type { Agent } from "@prospero/shared";
import { CHARTER_SKELETON } from "@prospero/shared";
import { readCharter } from "./role-charter-store.js";
import {
  ENTRY_FILENAME,
  getAgentInstructionsDir,
  instructionFilePath,
  assertSafeFilename,
} from "./instruction-bundle-dir.js";

// Per-agent instruction bundle — a directory of markdown files. charter.md is
// the entry (copied from the agent's role on first access); persona.md and any
// user-added files are extras. composeInstructions concatenates them into the
// agent's system prompt. The directory is the single source of truth.

export type InstructionFile = { filename: string; isEntry: boolean };

const PERSONA_FILENAME = "persona.md";

// Resolves the markdown body to seed charter.md from. A valid role id uses
// PR-A's charter store; anything else (no role, odd id) falls back to the
// blank 8-section skeleton.
const resolveRoleCharter = (userDataDir: string, templateId: string | null): string => {
  if (templateId !== null && /^role[-_][A-Za-z0-9-]+$/.test(templateId)) {
    return readCharter(userDataDir, templateId);
  }
  return CHARTER_SKELETON;
};

// Materializes the bundle the first time it is accessed: charter.md from the
// role charter, and persona.md from the legacy agent.system_prompt when that
// is non-empty. Idempotent — once charter.md exists, does nothing (so user
// edits are never clobbered).
export const ensureBundle = (userDataDir: string, agent: Agent): void => {
  const entryPath = instructionFilePath(userDataDir, agent.companyId, agent.id, ENTRY_FILENAME);
  if (existsSync(entryPath)) return;
  writeFileSync(entryPath, resolveRoleCharter(userDataDir, agent.templateId), "utf8");
  const persona = agent.systemPrompt.trim();
  if (persona.length > 0) {
    writeFileSync(
      instructionFilePath(userDataDir, agent.companyId, agent.id, PERSONA_FILENAME),
      `${persona}\n`,
      "utf8",
    );
  }
};

// Lists the bundle's files: the entry first, then extras sorted alphabetically.
export const listFiles = (userDataDir: string, agent: Agent): InstructionFile[] => {
  ensureBundle(userDataDir, agent);
  const dir = getAgentInstructionsDir(userDataDir, agent.companyId, agent.id);
  const extras = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== ENTRY_FILENAME)
    .sort((a, b) => a.localeCompare(b));
  return [
    { filename: ENTRY_FILENAME, isEntry: true },
    ...extras.map((filename) => ({ filename, isEntry: false })),
  ];
};

// Reads one file's body.
export const readFile = (userDataDir: string, agent: Agent, filename: string): string => {
  ensureBundle(userDataDir, agent);
  return readFileSync(
    instructionFilePath(userDataDir, agent.companyId, agent.id, filename),
    "utf8",
  );
};

// Writes one file's body (entry or extra).
export const writeFile = (
  userDataDir: string,
  agent: Agent,
  filename: string,
  body: string,
): void => {
  ensureBundle(userDataDir, agent);
  writeFileSync(
    instructionFilePath(userDataDir, agent.companyId, agent.id, filename),
    body,
    "utf8",
  );
};

// Creates a new empty extra file. Rejects the reserved entry name and any
// filename that already exists.
export const addFile = (userDataDir: string, agent: Agent, filename: string): void => {
  ensureBundle(userDataDir, agent);
  assertSafeFilename(filename);
  if (filename === ENTRY_FILENAME) {
    throw new Error(`"${ENTRY_FILENAME}" is the reserved entry file`);
  }
  const path = instructionFilePath(userDataDir, agent.companyId, agent.id, filename);
  if (existsSync(path)) throw new Error(`a file named "${filename}" already exists`);
  writeFileSync(path, `# ${filename.replace(/\.md$/, "")}\n\n`, "utf8");
};

// Deletes an extra file. Refuses the entry.
export const deleteFile = (userDataDir: string, agent: Agent, filename: string): void => {
  assertSafeFilename(filename);
  if (filename === ENTRY_FILENAME) {
    throw new Error(`the entry file "${ENTRY_FILENAME}" cannot be deleted`);
  }
  const path = instructionFilePath(userDataDir, agent.companyId, agent.id, filename);
  if (existsSync(path)) unlinkSync(path);
};

// Concatenates the whole bundle — entry first, extras alphabetically — into the
// single string fed to composeSystemPrompt as the agent persona slot.
export const composeInstructions = (userDataDir: string, agent: Agent): string => {
  return listFiles(userDataDir, agent)
    .map((f) => readFile(userDataDir, agent, f.filename).trim())
    .filter((body) => body.length > 0)
    .join("\n\n");
};
