import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, TrustTier } from "@prospero/shared";
import { evaluatePermission } from "../src/security/gate.js";
import { _setRecorderForTest } from "../src/activity/index.js";

const USER_DATA = process.platform === "win32" ? "C:\\UserData" : "/tmp/prospero-userdata";

const baseAgent = (
  mode: "supervised" | "auto" = "supervised",
  tier: TrustTier = "novato",
): Agent => ({
  id: "a1",
  companyId: "c1",
  name: "CEO",
  role: "CEO",
  systemPrompt: "",
  mode,
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-opus-4-7",
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
  autoModeSetAt: null,
});

beforeEach(() => {
  _setRecorderForTest({
    recordActivity: () => ({ id: "row" }) as never,
  });
});
afterEach(() => {
  _setRecorderForTest(null);
  vi.restoreAllMocks();
});

// Bug B from Task 0 of v0.2 piece #6 (memory project_p6_task0_runtime_bugs_diagnosis):
// George (CEO Opus, supervised) emitted `mcp__dashboard__decide_request` to
// approve a worker request. The gate routed it to `request_user`, creating an
// approval that needed user input. The user was asleep — CEO froze in `tool_use`
// for 8.5 hours waiting for its own approval. Circular deadlock.
describe("gate — meta MCP tools auto-allow (peça #6 hotfix)", () => {
  describe("decide_request (the deadlock fix)", () => {
    it("mcp__dashboard__decide_request in supervised mode → allow (was the deadlock)", () => {
      const r = evaluatePermission({
        toolName: "mcp__dashboard__decide_request",
        toolInput: { approval_id: "apv_x", decision: "approve" },
        agent: baseAgent("supervised"),
        allowedProjectPaths: [],
        agentCwd: USER_DATA,
        userDataDir: USER_DATA,
      });
      expect(r.action).toBe("allow");
    });

    it("bare decide_request also allowed (forward-compat if Claude drops prefix)", () => {
      const r = evaluatePermission({
        toolName: "decide_request",
        toolInput: { approval_id: "apv_x", decision: "approve" },
        agent: baseAgent("supervised"),
        allowedProjectPaths: [],
        agentCwd: USER_DATA,
        userDataDir: USER_DATA,
      });
      expect(r.action).toBe("allow");
    });
  });

  describe("orchestration MCP tools (paired with decide_request)", () => {
    it.each([
      ["mcp__dashboard__decide_batch"],
      ["mcp__dashboard__request_decision"],
      ["mcp__dashboard__request_permission"],
      ["mcp__dashboard__message_agent"],
      ["mcp__dashboard__notify_user"],
      ["mcp__dashboard__report_to_user"],
      ["mcp__dashboard__record_artifact"],
      ["mcp__dashboard__comment_on_issue"],
      ["mcp__dashboard__create_issue"],
      ["mcp__dashboard__update_issue"],
      ["mcp__dashboard__assign_issue"],
      ["mcp__dashboard__criterion_judge"],
    ])("%s in supervised mode → allow", (toolName) => {
      const r = evaluatePermission({
        toolName,
        toolInput: {},
        agent: baseAgent("supervised"),
        allowedProjectPaths: [],
        agentCwd: USER_DATA,
        userDataDir: USER_DATA,
      });
      expect(r.action).toBe("allow");
    });

    it("bare decide_batch also allowed (forward-compat if Claude drops prefix)", () => {
      const r = evaluatePermission({
        toolName: "decide_batch",
        toolInput: { decisions: [] },
        agent: baseAgent("supervised"),
        allowedProjectPaths: [],
        agentCwd: USER_DATA,
        userDataDir: USER_DATA,
      });
      expect(r.action).toBe("allow");
    });
  });

  describe("read-only MCP tools (existing classifier + new prefix-strip)", () => {
    it.each([
      ["mcp__dashboard__list_agents"],
      ["mcp__dashboard__list_projects"],
      ["mcp__dashboard__list_issues"],
      ["mcp__dashboard__list_pending_requests"],
      ["mcp__dashboard__read_thread"],
      ["mcp__dashboard__check_status"],
      ["mcp__dashboard__isa_read"],
      ["mcp__dashboard__telos_read"],
    ])("%s in supervised mode → allow (read-only)", (toolName) => {
      const r = evaluatePermission({
        toolName,
        toolInput: {},
        agent: baseAgent("supervised"),
        allowedProjectPaths: [],
        agentCwd: USER_DATA,
        userDataDir: USER_DATA,
      });
      expect(r.action).toBe("allow");
    });
  });

  describe("substantive MCP tools STILL gated in supervised mode", () => {
    it.each([["mcp__dashboard__hire_agent"], ["mcp__dashboard__fire_agent"]])(
      "%s in supervised mode → request_user (irreversible org-shape)",
      (toolName) => {
        const r = evaluatePermission({
          toolName,
          toolInput: {},
          agent: baseAgent("supervised"),
          allowedProjectPaths: [],
          agentCwd: USER_DATA,
          userDataDir: USER_DATA,
        });
        expect(r.action).toBe("request_user");
      },
    );
  });

  // 0.2.X P1 — the X connector. Publishing to a real account is irreversible, so
  // the publish tools must NOT be classified as read-only or meta (which would
  // auto-allow them even in supervised mode). The tools also self-gate in the MCP
  // child, but this locks the gate's own verdict as a second, independent guard.
  describe("X connector publish tools — gated in supervised, auto when trusted", () => {
    it.each([["mcp__dashboard__post_to_x"], ["mcp__dashboard__reply_on_x"]])(
      "%s in supervised mode → request_user (irreversible external publish)",
      (toolName) => {
        const r = evaluatePermission({
          toolName,
          toolInput: { text: "gm" },
          agent: baseAgent("supervised"),
          allowedProjectPaths: [],
          agentCwd: USER_DATA,
          userDataDir: USER_DATA,
        });
        expect(r.action).toBe("request_user");
      },
    );

    it.each([["mcp__dashboard__post_to_x"], ["mcp__dashboard__reply_on_x"]])(
      "%s in auto mode → allow (trust-graduated)",
      (toolName) => {
        const r = evaluatePermission({
          toolName,
          toolInput: { text: "gm" },
          agent: baseAgent("auto"),
          allowedProjectPaths: [],
          agentCwd: USER_DATA,
          userDataDir: USER_DATA,
        });
        expect(r.action).toBe("allow");
      },
    );
  });

  describe("auto mode bypasses gate as before (no regression)", () => {
    it("any tool in auto mode → allow", () => {
      const r = evaluatePermission({
        toolName: "mcp__dashboard__hire_agent",
        toolInput: {},
        agent: baseAgent("auto"),
        allowedProjectPaths: [],
        agentCwd: USER_DATA,
        userDataDir: USER_DATA,
      });
      expect(r.action).toBe("allow");
    });
  });
});
