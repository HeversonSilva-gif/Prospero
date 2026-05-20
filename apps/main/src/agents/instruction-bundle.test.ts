import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@prospero/shared";
import { instructionFilePath } from "./instruction-bundle-dir.js";
import {
  ensureBundle,
  listFiles,
  readFile,
  writeFile,
  addFile,
  deleteFile,
  composeInstructions,
} from "./instruction-bundle.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "prospero-bundle-"));

// Minimal Agent stub — the bundle store only reads id/companyId/templateId/systemPrompt.
const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "a1",
  companyId: "c1",
  name: "Eng",
  role: "engineer",
  systemPrompt: "",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
  trustTier: "novato",
  ...over,
});

describe("instruction-bundle", () => {
  it("ensureBundle materializes charter.md from the role charter", () => {
    const userData = tmp();
    ensureBundle(userData, agent({ templateId: "role-ceo" }));
    const charter = readFile(userData, agent({ templateId: "role-ceo" }), "charter.md");
    expect(charter.length).toBeGreaterThan(100);
  });

  it("ensureBundle seeds persona.md from a non-empty system_prompt", () => {
    const userData = tmp();
    ensureBundle(userData, agent({ systemPrompt: "Be concise and direct." }));
    expect(readFile(userData, agent(), "persona.md")).toContain("Be concise");
  });

  it("ensureBundle writes no persona.md when system_prompt is empty", () => {
    const userData = tmp();
    ensureBundle(userData, agent({ systemPrompt: "" }));
    expect(existsSync(instructionFilePath(userData, "c1", "a1", "persona.md"))).toBe(false);
  });

  it("ensureBundle is idempotent and does not overwrite edits", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    writeFile(userData, agent(), "charter.md", "# edited charter\n");
    ensureBundle(userData, agent());
    expect(readFile(userData, agent(), "charter.md")).toBe("# edited charter\n");
  });

  it("listFiles returns the entry first, then extras alphabetically", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    addFile(userData, agent(), "02-process.md");
    addFile(userData, agent(), "01-tone.md");
    const files = listFiles(userData, agent());
    expect(files.map((f) => f.filename)).toEqual(["charter.md", "01-tone.md", "02-process.md"]);
    expect(files[0]!.isEntry).toBe(true);
    expect(files[1]!.isEntry).toBe(false);
  });

  it("addFile rejects a duplicate and the reserved entry name", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    addFile(userData, agent(), "notes.md");
    expect(() => addFile(userData, agent(), "notes.md")).toThrow(/exists/i);
    expect(() => addFile(userData, agent(), "charter.md")).toThrow(/exists|reserved/i);
  });

  it("deleteFile removes an extra but refuses the entry", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    addFile(userData, agent(), "notes.md");
    deleteFile(userData, agent(), "notes.md");
    expect(listFiles(userData, agent()).map((f) => f.filename)).toEqual(["charter.md"]);
    expect(() => deleteFile(userData, agent(), "charter.md")).toThrow(/entry|charter/i);
  });

  it("composeInstructions concatenates the entry first, then extras", () => {
    const userData = tmp();
    ensureBundle(userData, agent());
    writeFile(userData, agent(), "charter.md", "CHARTER-BODY");
    addFile(userData, agent(), "extra.md");
    writeFile(userData, agent(), "extra.md", "EXTRA-BODY");
    const composed = composeInstructions(userData, agent());
    expect(composed.indexOf("CHARTER-BODY")).toBeLessThan(composed.indexOf("EXTRA-BODY"));
  });
});
