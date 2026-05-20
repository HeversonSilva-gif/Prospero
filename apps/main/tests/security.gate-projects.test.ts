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
});

describe("evaluatePermission with project allowlist", () => {
  it("denies FS write when allowedProjectPaths is empty", () => {
    const decision = evaluatePermission({
      toolName: "Write",
      toolInput: { file_path: "C:/foo/bar.txt" },
      agent: fakeAgent(),
      allowedProjectPaths: [],
      agentCwd: "C:/sandbox",
      userDataDir: "C:/UserData",
    });
    expect(decision.action).toBe("deny");
  });

  it("allows FS write inside any allowed project (auto mode)", () => {
    const decision = evaluatePermission({
      toolName: "Write",
      toolInput: { file_path: "C:/proj-a/sub/file.ts" },
      agent: fakeAgent(),
      allowedProjectPaths: ["C:/proj-a", "C:/proj-b"],
      agentCwd: "C:/sandbox",
      userDataDir: "C:/UserData",
    });
    expect(decision.action).toBe("allow");
  });

  it("denies FS write outside all allowed projects", () => {
    const decision = evaluatePermission({
      toolName: "Edit",
      toolInput: { file_path: "C:/proj-c/file.ts" },
      agent: fakeAgent(),
      allowedProjectPaths: ["C:/proj-a", "C:/proj-b"],
      agentCwd: "C:/sandbox",
      userDataDir: "C:/UserData",
    });
    expect(decision.action).toBe("deny");
  });

  it("Bash with absolute path outside any allowed project → deny", () => {
    const decision = evaluatePermission({
      toolName: "Bash",
      toolInput: { command: "ls C:/elsewhere" },
      agent: fakeAgent(),
      allowedProjectPaths: ["C:/proj-a"],
      agentCwd: "C:/sandbox",
      userDataDir: "C:/UserData",
    });
    expect(decision.action).toBe("deny");
  });
});
