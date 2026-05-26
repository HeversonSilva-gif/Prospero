// M13 PR-E containment zones — gate-level integration. Asserts that
// evaluatePermission denies + audits cross-zone FS access AFTER the
// path-fence has accepted the absolute path, and leaves intra-zone /
// unclassified paths untouched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Agent } from "@prospero/shared";

// Capture inbox-update broadcasts. broadcastInboxUpdate iterates
// BrowserWindow.getAllWindows() and calls send(IPC.INBOX_UPDATE, …) on each;
// expose a single fake window so the test can assert the broadcast fired.
const sendSpy = vi.fn();
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: (_name: string) => "/tmp/test-userdata" },
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: sendSpy } }],
  },
}));

import { evaluatePermission } from "../src/security/gate.js";
import { _setRecorderForTest, type Recorder } from "../src/activity/index.js";
import { _setInboxForTest, createInboxRepository } from "../src/inbox/index.js";
import { applyMigrations } from "../src/db/migrations.js";

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
  trustTier: "novato",
  autoModeSetAt: null,
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
    sendSpy.mockClear();
  });

  afterEach(() => {
    _setRecorderForTest(null);
    _setInboxForTest(null);
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
    // Read-only is auto-approved (audited as trust.readonly_autoapproved); the
    // invariant here is that the ZONE check did not fire a block.
    expect(recorded.some((rec) => rec.action === "security.zone_blocked")).toBe(false);
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
    // Read-only is auto-approved (audited as trust.readonly_autoapproved); the
    // invariant here is that the ZONE check did not fire a block.
    expect(recorded.some((rec) => rec.action === "security.zone_blocked")).toBe(false);
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
    // Read-only is auto-approved (audited as trust.readonly_autoapproved); the
    // invariant here is that the ZONE check did not fire a block.
    expect(recorded.some((rec) => rec.action === "security.zone_blocked")).toBe(false);
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

  describe("inbox card (M13 PR-F)", () => {
    const seedCompanyAndAgent = (
      db: Database.Database,
      companyId: string,
      agentId: string,
    ): void => {
      const now = Date.now();
      db.prepare("INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)").run(
        companyId,
        "Acme",
        now,
      );
      db.prepare(
        `INSERT INTO agents (id, company_id, name, role, system_prompt, capabilities_json, allowed_projects_json, mode, always_on, status, model, adapter_name, created_at, updated_at)
         VALUES (?, ?, ?, 'engineer', '', '[]', '[]', 'auto', 0, 'idle', 'claude-sonnet-4-6', 'claude-oauth-local', ?, ?)`,
      ).run(agentId, companyId, agentId, now, now);
    };

    it("creates an inbox card on the first cross-zone deny", () => {
      const db = new Database(":memory:");
      applyMigrations(db);
      seedCompanyAndAgent(db, "c-mine", "a1");
      const inbox = createInboxRepository(db);
      _setInboxForTest(inbox);

      const target = join(USER_DATA, "companies", "c-other", "telos.md");
      const r = evaluatePermission({
        toolName: "Read",
        toolInput: { file_path: target },
        agent: agent("c-mine", "a1"),
        allowedProjectPaths: [join(USER_DATA, "companies", "c-other")],
        agentCwd: USER_DATA,
        userDataDir: USER_DATA,
      });
      expect(r.action).toBe("deny");

      const rows = inbox.listByCompany("c-mine");
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row).toBeDefined();
      expect(row?.kind).toBe("security_zone_blocked");
      expect(row?.actorId).toBe("a1");
      expect(row?.requiresAction).toBe(false);
      expect(row?.payloadJson).not.toBeNull();
      const payload = JSON.parse(row!.payloadJson!) as {
        attemptedPath: string;
        zoneKind: string;
        reason: string;
      };
      expect(payload).toMatchObject({
        attemptedPath: target,
        zoneKind: "company",
        reason: "cross-company",
      });

      // Renderer must be notified so the inbox badge refreshes immediately.
      expect(sendSpy).toHaveBeenCalledWith("inbox:update", { companyId: "c-mine" });

      db.close();
    });

    it("de-dups repeated denials within 5 minutes", () => {
      const db = new Database(":memory:");
      applyMigrations(db);
      seedCompanyAndAgent(db, "c-mine", "a1");
      const inbox = createInboxRepository(db);
      _setInboxForTest(inbox);

      const target = join(USER_DATA, "companies", "c-other", "telos.md");
      const args = {
        toolName: "Read" as const,
        toolInput: { file_path: target },
        agent: agent("c-mine", "a1"),
        allowedProjectPaths: [join(USER_DATA, "companies", "c-other")],
        agentCwd: USER_DATA,
        userDataDir: USER_DATA,
      };
      evaluatePermission(args);
      evaluatePermission(args);
      evaluatePermission(args);

      const rows = inbox.listByCompany("c-mine");
      expect(rows).toHaveLength(1);

      db.close();
    });
  });
});
