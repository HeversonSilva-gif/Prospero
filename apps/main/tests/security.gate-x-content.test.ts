import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@prospero/shared";
import { evaluatePermission } from "../src/security/gate.js";
import { _setRecorderForTest } from "../src/activity/index.js";

const USER_DATA = process.platform === "win32" ? "C:\\UserData" : "/tmp/prospero-userdata";

const autoAgent = (): Agent => ({
  id: "a1",
  companyId: "c1",
  name: "A",
  role: "growth",
  systemPrompt: "",
  mode: "auto",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: ["x"],
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
  trustTier: "autonomo",
  autoModeSetAt: null,
});

const gate = (toolName: string, toolInput: unknown) =>
  evaluatePermission({
    toolName,
    toolInput,
    agent: autoAgent(),
    allowedProjectPaths: [],
    agentCwd: USER_DATA,
    userDataDir: USER_DATA,
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

describe("C1 — X content screen escapes blanket auto-approval", () => {
  it("a normal post auto-approves in auto mode (autonomy preserved)", () => {
    const r = gate("post_to_x", { text: "Lançamos uma novidade hoje, veja em exemplo.com" });
    expect(r.action).toBe("allow");
  });

  it("a normal reply auto-approves in auto mode", () => {
    const r = gate("reply_on_x", {
      tweet_id: "1",
      text: "Obrigado pelo feedback! Vamos melhorar.",
    });
    expect(r.action).toBe("allow");
  });

  it("mention-spam reply escalates to a human even in auto mode", () => {
    const r = gate("reply_on_x", {
      tweet_id: "1",
      text: "@a @b @c @d @e confira agora",
    });
    expect(r.action).toBe("request_user");
    expect(r.reason).toMatch(/menç|conteúdo X/i);
  });

  it("punctuation-separated mention spam still escalates (no comma/paren bypass)", () => {
    for (const text of ["@a,@b,@c,@d,@e", "(@a)(@b)(@c)(@d)(@e)", "@a;@b;@c;@d;@e"]) {
      const r = gate("reply_on_x", { tweet_id: "1", text });
      expect(r.action).toBe("request_user");
    }
  });

  it("hashtag-stuffed post escalates to a human", () => {
    const r = gate("post_to_x", { text: "promo #a #b #c #d #e #f #g" });
    expect(r.action).toBe("request_user");
  });

  it("link-spam post escalates to a human", () => {
    const r = gate("post_to_x", { text: "http://a.com http://b.com http://c.com" });
    expect(r.action).toBe("request_user");
  });

  it("does not affect non-X tools in auto mode", () => {
    const r = gate("comment_on_issue", { issue_id: "i1", text: "@a @b @c @d @e" });
    expect(r.action).toBe("allow");
  });
});
