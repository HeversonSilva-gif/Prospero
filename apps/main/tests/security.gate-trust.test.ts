import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, TrustTier } from "@prospero/shared";
import { evaluatePermission } from "../src/security/gate.js";
import { _setRecorderForTest } from "../src/activity/index.js";

const USER_DATA = process.platform === "win32" ? "C:\\UserData" : "/tmp/prospero-userdata";

const baseAgent = (tier: TrustTier, mode: "supervised" | "auto" = "supervised"): Agent => ({
  id: "a1",
  companyId: "c1",
  name: "A",
  role: "engineer",
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
  trustTier: tier,
});

type Rec = { action: string };
let recorded: Rec[];

beforeEach(() => {
  recorded = [];
  _setRecorderForTest({
    recordActivity: (input) => {
      recorded.push({ action: input.action });
      return { id: "row" } as never;
    },
  });
});
afterEach(() => {
  _setRecorderForTest(null);
  vi.restoreAllMocks();
});

const WS = process.platform === "win32" ? "C:\\Workspace" : "/some/project";
const FILE = process.platform === "win32" ? "C:\\Workspace\\file.ts" : "/some/project/file.ts";

describe("trust ladder gate rule (M14 PR-A)", () => {
  it("novato + Read → goes through normal path (supervised → request_user)", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: FILE },
      agent: baseAgent("novato"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("request_user");
  });

  it("confiavel + Read inside allowed → auto-allow with trust reason", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: FILE },
      agent: baseAgent("confiavel"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
    expect(r.reason).toMatch(/trust:confiavel-readonly/);
    expect(recorded.some((x) => x.action === "trust.readonly_autoapproved")).toBe(true);
  });

  it("confiavel + Write → still goes through normal path (NOT auto-allowed)", () => {
    const r = evaluatePermission({
      toolName: "Write",
      toolInput: { file_path: FILE },
      agent: baseAgent("confiavel"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("request_user");
    expect(recorded.some((x) => x.action === "trust.readonly_autoapproved")).toBe(false);
  });

  it("confiavel + Read of always-blocked sensitive path → still blocked", () => {
    // `.ssh/` is in the always-blocked pathPrefix list (M5 §8.3). The trust
    // auto-allow must NOT bypass this.
    const sshPath =
      process.platform === "win32" ? "C:\\Users\\me\\.ssh\\id_rsa" : "/home/me/.ssh/id_rsa";
    const sshParent = process.platform === "win32" ? "C:\\Users\\me\\.ssh" : "/home/me/.ssh";
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: sshPath },
      agent: baseAgent("confiavel", "auto"),
      allowedProjectPaths: [sshParent],
      agentCwd: sshParent,
      userDataDir: USER_DATA,
    });
    expect(r.action).not.toBe("allow");
    expect(r.reason).toMatch(/always-blocked|sensitive/i);
  });

  it("autonomo + Read → auto-allow with trust reason", () => {
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: FILE },
      agent: baseAgent("autonomo", "auto"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
    expect(r.reason).toMatch(/trust:/);
  });

  it("Read outside allowed projects → still denied even for confiavel", () => {
    const elsewhere =
      process.platform === "win32" ? "C:\\Other\\secret.txt" : "/other/project/secret.txt";
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: elsewhere },
      agent: baseAgent("confiavel"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    // Path-fence wins — trust does not expand reach, only auto-approves within it.
    expect(r.action).toBe("deny");
  });
});
