import { describe, expect, it } from "vitest";
import { evaluatePermission } from "../src/security/gate.js";
import type { Agent } from "@prospero/shared";

const agent = (mode: "supervised" | "auto"): Agent => ({
  id: "a",
  companyId: "c",
  name: "n",
  role: "r",
  systemPrompt: "",
  mode,
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
  autoModeSetAt: null,
});

// Absolute paths must use the HOST platform's semantics: node:path (and thus the
// gate's resolve()/isAbsolute() checks) treats "C:\..." as absolute only on Windows
// and "/..." as absolute only on POSIX. Hardcoding Windows paths made these tests pass
// on Windows but invert on the Linux/macOS CI runners. Build paths per-platform so the
// gate logic is exercised identically everywhere.
const WIN = process.platform === "win32";
const WS = WIN ? "C:\\Workspace" : "/workspace";
const USER_DATA = WIN ? "C:\\UserData" : "/userdata";
const INSIDE_FILE = WIN ? "C:\\Workspace\\src\\index.ts" : "/workspace/src/index.ts";
const ESCAPE_REL = WIN ? "C:\\Workspace\\..\\..\\escape.txt" : "/workspace/../../escape.txt";
const OUTSIDE_ABS_CMD = WIN ? "ls C:\\Users\\Other\\file.txt" : "ls /srv/other/file.txt";
const OUTSIDE_QUOTED_CMD = WIN
  ? 'ls "D:\\Projetos pessoais\\MTT"'
  : 'ls "/srv/projetos pessoais/MTT"';
const INSIDE_QUOTED_CMD = WIN
  ? 'ls "C:\\Workspace\\sub dir\\file.ts"'
  : 'ls "/workspace/sub dir/file.ts"';

describe("evaluatePermission §1 always-blocked patterns", () => {
  it("Bash credential read → request_user even in auto mode", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "cat ~/.credentials.json" },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("request_user");
    expect(r.reason).toMatch(/always-blocked/i);
  });

  it("Bash rm -rf / → request_user even in auto mode", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "rm -rf /" },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("request_user");
  });
});

describe("evaluatePermission §2 path-tool outside workspace", () => {
  it("Read of /etc/passwd → deny", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: "/etc/passwd" },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("deny");
    expect(r.reason).toMatch(/outside allowed projects/i);
  });

  it("Write to ../../escape.txt → deny", () => {
    const r = evaluatePermission({
      toolName: "Write",
      toolInput: { file_path: ESCAPE_REL },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("deny");
  });

  it("Edit inside workspace → allow (auto mode)", () => {
    const r = evaluatePermission({
      toolName: "Edit",
      toolInput: { file_path: INSIDE_FILE },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
  });

  it("Edit inside workspace → request_user (supervised)", () => {
    const r = evaluatePermission({
      toolName: "Edit",
      toolInput: { file_path: INSIDE_FILE },
      agent: agent("supervised"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("request_user");
  });
});

describe("evaluatePermission §3 Bash path extraction", () => {
  it("Bash with cat ~/.ssh/id_rsa → request_user (always-blocked)", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "cat ~/.ssh/id_rsa" },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("request_user");
  });

  it("Bash with absolute path outside workspace → deny (strict isolation)", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: OUTSIDE_ABS_CMD },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("deny");
  });

  it("Bash echo hello (no path-like) → allow in auto", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "echo hello" },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
  });

  it("Bash with double-quoted path outside workspace → deny (regression: quoted paths used to bypass gate)", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: OUTSIDE_QUOTED_CMD },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("deny");
  });

  it("Bash with single-quoted path outside workspace → deny", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "ls '/etc/some path/file'" },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("deny");
  });

  it("Bash with quoted path INSIDE workspace → allow in auto", () => {
    const r = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: INSIDE_QUOTED_CMD },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
  });
});

describe("evaluatePermission §4 non-fs tools (orchestrator MCP)", () => {
  it("hire_agent in auto → allow", () => {
    const r = evaluatePermission({
      toolName: "hire_agent",
      toolInput: { name: "Alice", role: "FE", system_prompt: "..." },
      agent: agent("auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
  });

  it("hire_agent in supervised → request_user", () => {
    const r = evaluatePermission({
      toolName: "hire_agent",
      toolInput: { name: "Alice", role: "FE", system_prompt: "..." },
      agent: agent("supervised"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("request_user");
  });
});
