// M13 PR-E containment zones — gate-level integration. Asserts that
// evaluatePermission denies + audits cross-zone FS access AFTER the
// path-fence has accepted the absolute path, and leaves intra-zone /
// unclassified paths untouched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import type { Agent } from "@prospero/shared";
import { evaluatePermission } from "../src/security/gate.js";
import { _setRecorderForTest, type Recorder } from "../src/activity/index.js";

const USER_DATA = process.platform === "win32" ? "C:\\UserData" : "/tmp/prospero-userdata";

const agent = (companyId: string, id: string): Agent => ({
  id,
  companyId,
  name: id,
  role: "FE",
  systemPrompt: "",
  mode: "auto",
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
});

type RecordedCall = { action: string; payload: unknown; agentId: string | null | undefined };

const setupRecorder = (): {
  recorded: RecordedCall[];
  recordActivity: Recorder["recordActivity"];
} => {
  const recorded: RecordedCall[] = [];
  const recordActivity: Recorder["recordActivity"] = (input) => {
    recorded.push({ action: input.action, payload: input.payload, agentId: input.agentId });
    // recorder normally returns the inserted row — tests only need the side-effect
    return { id: "row" } as never;
  };
  return { recorded, recordActivity };
};

describe("evaluatePermission §5 containment zones (M13 PR-E)", () => {
  let recorded: RecordedCall[];

  beforeEach(() => {
    const fixture = setupRecorder();
    recorded = fixture.recorded;
    _setRecorderForTest({ recordActivity: fixture.recordActivity });
  });

  afterEach(() => {
    _setRecorderForTest(null);
    vi.restoreAllMocks();
  });

  it("denies a cross-company file access with reason 'cross-company' + audits", () => {
    const target = join(USER_DATA, "companies", "c-other", "telos.md");
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: target },
      agent: agent("c-mine", "a1"),
      // path-fence would otherwise say allow — make sure the deny is purely zone-based
      allowedProjectPaths: [join(USER_DATA, "companies", "c-other")],
      agentCwd: USER_DATA,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("deny");
    expect(r.reason).toMatch(/zone_blocked: cross-company/);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.action).toBe("security.zone_blocked");
    expect(recorded[0]?.payload).toMatchObject({
      attemptedPath: target,
      zoneKind: "company",
      reason: "cross-company",
    });
    expect(recorded[0]?.agentId).toBe("a1");
  });

  it("denies a cross-agent file access (same company) with reason 'cross-agent'", () => {
    const target = join(USER_DATA, "companies", "c1", "agents", "a-other", "charter.md");
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: target },
      agent: agent("c1", "a1"),
      allowedProjectPaths: [join(USER_DATA, "companies", "c1")],
      agentCwd: USER_DATA,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("deny");
    expect(r.reason).toMatch(/zone_blocked: cross-agent/);
    expect(recorded[0]?.payload).toMatchObject({ zoneKind: "agent", reason: "cross-agent" });
  });

  it("allows the agent to touch its own agent zone", () => {
    const target = join(USER_DATA, "companies", "c1", "agents", "a1", "charter.md");
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: target },
      agent: agent("c1", "a1"),
      allowedProjectPaths: [join(USER_DATA, "companies", "c1")],
      agentCwd: USER_DATA,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
    expect(recorded).toHaveLength(0);
  });

  it("allows the agent to touch its own company zone", () => {
    const target = join(USER_DATA, "companies", "c1", "telos.md");
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: target },
      agent: agent("c1", "a1"),
      allowedProjectPaths: [join(USER_DATA, "companies", "c1")],
      agentCwd: USER_DATA,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
    expect(recorded).toHaveLength(0);
  });

  it("does not block paths outside the zone system (zoneOf returns null)", () => {
    // A project file unrelated to userData: zoneOf returns null, so the gate
    // defers entirely to the path-fence.
    const WS = process.platform === "win32" ? "C:\\Workspace" : "/some/project";
    const target =
      process.platform === "win32" ? "C:\\Workspace\\src\\index.ts" : "/some/project/file.ts";
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: target },
      agent: agent("c1", "a1"),
      allowedProjectPaths: [WS],
      agentCwd: WS,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("allow");
    expect(recorded).toHaveLength(0);
  });

  it("does not audit when the path-fence already denied (deny wins, no double-audit)", () => {
    // The file_path is inside another company's zone, but the path-fence does
    // NOT include it in allowedProjectPaths — so the path-fence denies first
    // and the zone check is never reached.
    const target = join(USER_DATA, "companies", "c-other", "telos.md");
    const r = evaluatePermission({
      toolName: "Read",
      toolInput: { file_path: target },
      agent: agent("c-mine", "a1"),
      allowedProjectPaths: [], // path-fence denies
      agentCwd: USER_DATA,
      userDataDir: USER_DATA,
    });
    expect(r.action).toBe("deny");
    expect(r.reason).toMatch(/outside allowed projects/i);
    expect(recorded).toHaveLength(0);
  });
});
