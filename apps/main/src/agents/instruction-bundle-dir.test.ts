import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENTRY_FILENAME,
  getAgentInstructionsDir,
  instructionFilePath,
  assertSafeFilename,
} from "./instruction-bundle-dir.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "prospero-instr-"));

describe("instruction-bundle-dir", () => {
  it("the entry filename is charter.md", () => {
    expect(ENTRY_FILENAME).toBe("charter.md");
  });

  it("getAgentInstructionsDir nests under agent-instructions and creates it", () => {
    const dir = getAgentInstructionsDir(tmp(), "c1", "a1");
    expect(dir.endsWith(join("agent-instructions", "companies", "c1", "agents", "a1"))).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });

  it("instructionFilePath joins a filename onto the bundle dir", () => {
    const userData = tmp();
    const path = instructionFilePath(userData, "c1", "a1", "charter.md");
    expect(path).toBe(join(getAgentInstructionsDir(userData, "c1", "a1"), "charter.md"));
  });

  it("assertSafeFilename accepts kebab .md names", () => {
    expect(() => assertSafeFilename("charter.md")).not.toThrow();
    expect(() => assertSafeFilename("01-tone.md")).not.toThrow();
  });

  it("assertSafeFilename rejects traversal, subpaths and non-md names", () => {
    expect(() => assertSafeFilename("../escape.md")).toThrow();
    expect(() => assertSafeFilename("sub/file.md")).toThrow();
    expect(() => assertSafeFilename("sub\\file.md")).toThrow();
    expect(() => assertSafeFilename("notes.txt")).toThrow();
    expect(() => assertSafeFilename("")).toThrow();
    expect(() => assertSafeFilename(".md")).toThrow();
  });
});
