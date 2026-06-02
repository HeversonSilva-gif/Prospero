import { describe, expect, it } from "vitest";
import { evaluatePermission } from "../src/security/gate.js";
import type { Agent } from "@prospero/shared";

const fakeAgent = (mode: "supervised" | "auto" = "auto"): Agent => ({
  id: "a1",
  companyId: "c1",
  name: "X",
  role: "x",
  systemPrompt: "x",
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

// Platform-aware absolute paths: node:path treats "C:/..." as absolute only on
// Windows. Hardcoding them made these tests invert on the Linux/macOS CI runners.
const WIN = process.platform === "win32";
const SANDBOX = WIN ? "C:\\sandbox" : "/sandbox";
const USER_DATA = WIN ? "C:\\UserData" : "/userdata";
const PROJ_A = WIN ? "C:\\proj-a" : "/proj-a";
const PROJ_B = WIN ? "C:\\proj-b" : "/proj-b";
const EMPTY_FILE = WIN ? "C:\\foo\\bar.txt" : "/foo/bar.txt";
const INSIDE_A = WIN ? "C:\\proj-a\\sub\\file.ts" : "/proj-a/sub/file.ts";
const OUTSIDE_C = WIN ? "C:\\proj-c\\file.ts" : "/proj-c/file.ts";
const OUTSIDE_CMD = WIN ? "ls C:\\elsewhere" : "ls /elsewhere";

describe("evaluatePermission with project allowlist", () => {
  it("denies FS write when allowedProjectPaths is empty", () => {
    const decision = evaluatePermission({
      toolName: "Write",
      toolInput: { file_path: EMPTY_FILE },
      agent: fakeAgent(),
      allowedProjectPaths: [],
      agentCwd: SANDBOX,
      userDataDir: USER_DATA,
    });
    expect(decision.action).toBe("deny");
  });

  it("allows FS write inside any allowed project (auto mode)", () => {
    const decision = evaluatePermission({
      toolName: "Write",
      toolInput: { file_path: INSIDE_A },
      agent: fakeAgent(),
      allowedProjectPaths: [PROJ_A, PROJ_B],
      agentCwd: SANDBOX,
      userDataDir: USER_DATA,
    });
    expect(decision.action).toBe("allow");
  });

  it("denies FS write outside all allowed projects", () => {
    const decision = evaluatePermission({
      toolName: "Edit",
      toolInput: { file_path: OUTSIDE_C },
      agent: fakeAgent(),
      allowedProjectPaths: [PROJ_A, PROJ_B],
      agentCwd: SANDBOX,
      userDataDir: USER_DATA,
    });
    expect(decision.action).toBe("deny");
  });

  it("Bash with absolute path outside any allowed project → deny", () => {
    const decision = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: OUTSIDE_CMD },
      agent: fakeAgent(),
      allowedProjectPaths: [PROJ_A],
      agentCwd: SANDBOX,
      userDataDir: USER_DATA,
    });
    expect(decision.action).toBe("deny");
  });
});
