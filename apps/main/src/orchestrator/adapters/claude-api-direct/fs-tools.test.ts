import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@prospero/shared";
import { fsToolDefs, isFsTool, runFsTool, type FsSecCtx } from "./fs-tools.js";

// A real Agent-shaped object. supervised mode is fine — read-only tools are
// auto-allowed for every mode AFTER the path-fence, so the gate never routes
// these to request_user purely on mode.
const makeAgent = (): Agent => ({
  id: "agent1",
  companyId: "c1",
  name: "CEO",
  role: "ceo",
  systemPrompt: "",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-opus-4-8",
  capabilities: ["fs-read"],
  templateId: "role-ceo",
  reportsTo: null,
  adapterName: "claude-api-direct",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "monthly",
  canHire: true,
  canAssign: true,
  trustTier: "novato",
  autoModeSetAt: null,
});

let projectDir: string;
let outsideDir: string;
let sec: FsSecCtx;

beforeAll(() => {
  // Temp dirs live under tmpdir() which is OUTSIDE Electron userData, so
  // zoneOf() returns null and the path-fence governs (as the spec notes).
  projectDir = mkdtempSync(join(tmpdir(), "fstools-allowed-"));
  outsideDir = mkdtempSync(join(tmpdir(), "fstools-outside-"));

  writeFileSync(join(projectDir, "manual.md"), "line1\nline2\nline3\nline4\nline5\n", "utf8");
  writeFileSync(join(projectDir, "notes.txt"), "alpha\nNEEDLE here\nbeta\n", "utf8");
  mkdirSync(join(projectDir, "sub"), { recursive: true });
  writeFileSync(join(projectDir, "sub", "deep.md"), "deep NEEDLE in subdir\n", "utf8");
  writeFileSync(join(projectDir, "sub", "other.txt"), "nothing relevant\n", "utf8");

  writeFileSync(join(outsideDir, "secret.txt"), "TOP SECRET should never be read\n", "utf8");

  sec = {
    agent: makeAgent(),
    allowedProjectPaths: [projectDir],
    agentCwd: projectDir,
    userDataDir: join(tmpdir(), "fstools-userdata-does-not-exist"),
  };
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

describe("fsToolDefs", () => {
  it("returns Read/Glob/Grep with object input_schema", () => {
    const defs = fsToolDefs();
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual(["Glob", "Grep", "Read"]);
    for (const d of defs) {
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.input_schema.type).toBe("object");
    }
  });
});

describe("isFsTool", () => {
  it("recognizes Read/Glob/Grep and rejects others", () => {
    expect(isFsTool("Read")).toBe(true);
    expect(isFsTool("Glob")).toBe(true);
    expect(isFsTool("Grep")).toBe(true);
    expect(isFsTool("Write")).toBe(false);
    expect(isFsTool("create_goal")).toBe(false);
  });
});

describe("runFsTool — Read", () => {
  it("reads an allowed file and returns its content", async () => {
    const out = await runFsTool("Read", { file_path: join(projectDir, "manual.md") }, sec);
    expect(out).toContain("line1");
    expect(out).toContain("line5");
    expect(out.startsWith("[denied]")).toBe(false);
    expect(out.startsWith("[error]")).toBe(false);
  });

  it("resolves a relative file_path against agentCwd", async () => {
    const out = await runFsTool("Read", { file_path: "manual.md" }, sec);
    expect(out).toContain("line3");
  });

  it("DENIES a path outside allowedProjectPaths and does NOT read", async () => {
    const out = await runFsTool("Read", { file_path: join(outsideDir, "secret.txt") }, sec);
    expect(out.startsWith("[denied]")).toBe(true);
    expect(out).not.toContain("TOP SECRET");
  });

  it("applies offset/limit by lines (1-based offset, limit = max lines)", async () => {
    const out = await runFsTool(
      "Read",
      { file_path: join(projectDir, "manual.md"), offset: 2, limit: 2 },
      sec,
    );
    expect(out).toContain("line2");
    expect(out).toContain("line3");
    expect(out).not.toContain("line1");
    expect(out).not.toContain("line4");
  });

  it("returns a non-throwing [error] string for a missing file", async () => {
    const out = await runFsTool("Read", { file_path: join(projectDir, "nope.md") }, sec);
    expect(out.startsWith("[error]")).toBe(true);
  });
});

describe("runFsTool — Glob", () => {
  it("finds files under the allowed dir", async () => {
    const out = await runFsTool("Glob", { pattern: "**/*.md" }, sec);
    expect(out).toContain("manual.md");
    expect(out).toContain("deep.md");
    expect(out).not.toContain("notes.txt");
  });

  it("DENIES a path outside allowedProjectPaths", async () => {
    const out = await runFsTool("Glob", { pattern: "**/*", path: outsideDir }, sec);
    expect(out.startsWith("[denied]")).toBe(true);
    expect(out).not.toContain("secret.txt");
  });
});

describe("runFsTool — Grep", () => {
  it("finds a matching line under the allowed dir", async () => {
    const out = await runFsTool("Grep", { pattern: "NEEDLE" }, sec);
    expect(out).toContain("NEEDLE");
    expect(out).toMatch(/notes\.txt:2:/);
  });

  it("filters by glob", async () => {
    const out = await runFsTool("Grep", { pattern: "NEEDLE", glob: "**/*.md" }, sec);
    expect(out).toContain("deep.md");
    expect(out).not.toContain("notes.txt");
  });

  it("DENIES a path outside allowedProjectPaths and does NOT read", async () => {
    const out = await runFsTool("Grep", { pattern: "SECRET", path: outsideDir }, sec);
    expect(out.startsWith("[denied]")).toBe(true);
    expect(out).not.toContain("TOP SECRET");
  });
});
